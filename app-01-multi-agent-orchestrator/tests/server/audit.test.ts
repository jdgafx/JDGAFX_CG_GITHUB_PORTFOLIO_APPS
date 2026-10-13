import { describe, expect, it } from 'vitest'
import handler from '../../netlify/functions/audit'
import { FIXED_MODEL, PROVIDER_TIMEOUT, SERVED, SITE, installHarness, lengthReply, providerCalls, refuse, request, stubFetch, unfinishedReply, unnamedReply } from './helpers'

const PREVIEW = 'https://deploy-preview-9--jdgafx-app-01-multi-agent-orchestrator.netlify.app'

installHarness()

const JWST =
  'The James Webb Space Telescope (JWST) is a space telescope designed to conduct infrared astronomy. Its 6.5 meter primary mirror lets it see objects too old and distant for Hubble.'
const SOURCES = [{ n: 1, title: 'James Webb Space Telescope', site: 'Wikipedia', snippet: JWST }]
const REPORT = [
  'JWST is built for infrared astronomy [1].',
  'Its primary mirror is 9 metres wide [1].',
  'Bananas are rich in potassium and grow in tropical regions [1].',
  '',
  '### Sources',
  '',
  '1. [James Webb Space Telescope](https://en.wikipedia.org/wiki/James_Webb_Space_Telescope) - Wikipedia',
].join('\n')

function modelReply(text: string, usage = { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380, cost: 0.0004 }): () => Response {
  return () =>
    new Response(
      [{ model: 'anthropic/claude-haiku-5.5', choices: [{ delta: { content: text } }] }, { model: 'anthropic/claude-haiku-5.5', choices: [{ delta: {}, finish_reason: 'stop' }], usage }]
        .map(value => `data: ${JSON.stringify(value)}\n\n`)
        .join('') + 'data: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )
}

const body = (report = REPORT) => JSON.stringify({ report, sources: SOURCES })

const span = (text: string, source = 1) => ({ source, text })
const answer = (...results: unknown[]) => JSON.stringify({ results })
/** One typed entry: the model sends criteria, never a verdict. 'supported' passes all, 'partly' fails all_parts_covered, 'unsupported' fails source_supports. */
const CRITERIA = {
  supported: { kind: 'source_claim', source_supports: 'yes', subject_matches: 'yes', cause_matches: 'not_applicable', all_parts_covered: 'yes' },
  partly: { kind: 'source_claim', source_supports: 'yes', subject_matches: 'yes', cause_matches: 'not_applicable', all_parts_covered: 'no' },
  unsupported: { kind: 'source_claim', source_supports: 'no', subject_matches: 'no', cause_matches: 'not_applicable', all_parts_covered: 'no' },
}
const j = (id: number, kind: keyof typeof CRITERIA, rest: Record<string, unknown> = {}) => ({ id, ...CRITERIA[kind], ...rest })
const LENGTH_ERROR = 'The audit ran out of reply length before it finished. Try again.'

describe('audit function', () => {
  it('judges every cited sentence with one model call, and checks each span word for word', async () => {
    const fetchMock = stubFetch(async (_url, init) => {
      const sent = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }>; temperature?: number }
      expect(sent.model).toBe(FIXED_MODEL)
      expect('temperature' in sent).toBe(false)
      expect(sent.messages[1]?.content).toContain('1. JWST is built for infrared astronomy [1].')
      expect(sent.messages[1]?.content).toContain('2. Its primary mirror is 9 metres wide [1].')
      expect(sent.messages[1]?.content).not.toContain('Context:')
      expect(sent.messages[1]?.content).toContain('3. Bananas are rich in potassium and grow in tropical regions [1].')
      return modelReply(
        answer(
          j(1, 'supported', { spans: [span('designed to conduct infrared astronomy')], reason: 'Stated.' }),
          j(2, 'partly', { spans: [span('Its 6.5 meter primary mirror lets it see objects')], uncovered: 'the 9 metre width', reason: 'Source says 6.5 meter.' }),
          j(3, 'unsupported', { reason: 'Not about the telescope.' }),
        ),
      )()
    })

    const res = await handler(request(body()))
    expect(res.status).toBe(200)
    const result = (await res.json()) as {
      claims: Array<{ id: number; verdict: string; reason: string; uncovered?: string; quotes?: Array<{ n: number; text: string }> }>
      summary: Record<string, number>
      usage: { total_tokens: number }
      model: string
    }

    expect(providerCalls(fetchMock)).toHaveLength(1)
    expect(result.claims.map(claim => [claim.id, claim.verdict])).toEqual([
      [1, 'supported'],
      [2, 'partly'],
      [3, 'unsupported'],
    ])
    expect(result.claims[0]?.quotes).toMatchObject([{ n: 1, text: 'designed to conduct infrared astronomy' }])
    expect(result.claims[1]?.uncovered).toBe('the 9 metre width')
    expect(result.summary).toEqual({ total: 3, supported: 1, partly: 1, unsupported: 1, unchecked: 0, unverified: 0, research: 0 })
    expect(result.usage.total_tokens).toBe(380)
    expect(result.model).toEqual({ servedModel: SERVED, newestModel: SERVED, modelCheck: 'match' })
  })

  it('shows a supported verdict whose span is not in the source as unverified, and a sentence the model skipped as not checked', async () => {
    stubFetch(() => modelReply(answer(j(1, 'supported', { spans: [span('it was launched in the year 2021 by NASA')], reason: 'x' })))())
    const res = await handler(request(body()))
    const result = (await res.json()) as { claims: Array<{ verdict: string; quotes?: unknown; reason: string }>; summary: Record<string, number> }
    expect(result.claims.map(claim => claim.verdict)).toEqual(['unverified', 'unchecked', 'unchecked'])
    expect(result.claims[0]?.quotes).toBeUndefined()
    expect(result.claims[0]?.reason).toContain('not found in the source')
    expect(result.summary).toMatchObject({ unverified: 1, unchecked: 2, supported: 0 })
  })

  it('shows a judgment whose reply named no model as not reported, never as the requested alias', async () => {
    stubFetch(unnamedReply(answer(j(1, 'supported', { spans: [span('designed to conduct infrared astronomy')], reason: 'Stated.' }))))
    const res = await handler(request(body()))
    const result = (await res.json()) as { model: unknown }
    expect(result.model).toEqual({ servedModel: null, newestModel: SERVED, modelCheck: 'not-reported' })
  })

  it.each([
    ['length', lengthReply],
    ['no finish reason', unfinishedReply],
  ])('stops with a visible error and uses no verdict when the final attempt ends with %s, even if the JSON is complete', async (_name, cutOff) => {
    const fetchMock = stubFetch(
      cutOff(answer(j(1, 'supported', { spans: [span('designed to conduct infrared astronomy')], reason: 'Stated.' }), j(2, 'supported', { spans: [span('Its 6.5 meter primary mirror lets it see objects')] }))),
    )
    const res = await handler(request(body()))
    expect(res.status).toBe(502)
    const message = ((await res.json()) as { error: string }).error
    expect(message).toBe(_name === 'length' ? LENGTH_ERROR : 'The audit stopped before it finished. Try again.')
    // The second attempt was cut off too, so no verdict from either was used.
    expect(providerCalls(fetchMock)).toHaveLength(2)
  })

  it('uses a retry that finished when the first attempt was cut off by length', async () => {
    let calls = 0
    stubFetch(() => {
      calls += 1
      return calls === 1
        ? lengthReply(answer(j(1, 'unsupported', { reason: 'a longer first attempt, cut off, with a verdict that must not be used' })))()
        : modelReply(answer(j(1, 'supported', { spans: [span('designed to conduct infrared astronomy')], reason: 'Stated.' })))()
    })
    const res = await handler(request(body('JWST is built for infrared astronomy [1].')))
    const result = (await res.json()) as { claims: Array<{ verdict: string }>; retried?: string }
    expect(calls).toBe(2)
    expect(result.retried).toBe('reply')
    expect(result.claims[0]?.verdict).toBe('supported')
  })

  it('makes no model call when every sentence cites a source that is not in the list', async () => {
    const fetchMock = stubFetch(() => modelReply('{}')())
    const res = await handler(request(body('Bananas are rich in potassium [4].')))
    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    const result = (await res.json()) as { summary: Record<string, number> }
    expect(result.summary).toMatchObject({ total: 1, unsupported: 1 })
  })

  it('sends the preceding sentence of the same paragraph as read-only context', async () => {
    const fetchMock = stubFetch(() => modelReply(answer(j(1, 'supported', { spans: [span('designed to conduct infrared astronomy')] }), j(2, 'partly')))())
    await handler(request(body('JWST is built for infrared astronomy [1]. Its primary mirror is 9 metres wide [1].')))
    const sent = JSON.parse(String(providerCalls(fetchMock)[0]?.[1]?.body)) as { messages: Array<{ content: string }> }
    expect(sent.messages[1]?.content).toContain('2. Its primary mirror is 9 metres wide [1].\n   Context: JWST is built for infrared astronomy.')
  })

  it('shows a claim the model marks about_research as such, never as supported or unsupported, and counts it apart', async () => {
    stubFetch(() => modelReply(answer(j(1, 'supported', { spans: [span('designed to conduct infrared astronomy')] }), { id: 2, kind: 'about_research', reason: 'About the evidence base.' }, { id: 3, kind: 'about_research' }))())
    const res = await handler(request(body()))
    const result = (await res.json()) as { claims: Array<{ verdict: string; reason: string }>; summary: Record<string, number> }
    expect(result.claims.map(claim => claim.verdict)).toEqual(['supported', 'research', 'research'])
    expect(result.claims[1]?.reason).toBe('About the evidence base.')
    expect(result.summary).toMatchObject({ total: 3, supported: 1, unsupported: 0, research: 2 })
  })

  it('records the model\'s spans and the span check per claim, and the finish reason and reasoning tokens per audit call', async () => {
    const usage = { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380, cost: 0.0004, completion_tokens_details: { reasoning_tokens: 55 } }
    stubFetch(() =>
      modelReply(
        answer(
          j(1, 'supported', { spans: [span('it was launched in the year 2021 by NASA'), span('designed to conduct infrared astronomy'), { source: 'x' }], reason: 'x' }),
          j(2, 'partly', { spans: [span('Its 6.5 meter primary mirror lets it see objects')], uncovered: 'the 9 metre width' }),
        ),
        usage,
      )(),
    )
    const res = await handler(request(body('JWST is built for infrared astronomy [1]. Its primary mirror is 9 metres wide [1].')))
    const result = (await res.json()) as {
      claims: Array<{ verdict: string; judged: { kind: string; answers: Record<string, string>; spans: { asked: Array<{ text: string }>; found: number; missed: number; joined: number; malformed: number } } }>
      callTrace: Array<{ claims: number[]; finish: string | null; reasoningTokens: number; usage: { total_tokens: number } }>
    }
    // Two spans were asked, one was malformed: the check records what was asked and what happened to each.
    expect(result.claims[0]?.verdict).toBe('unverified')
    expect(result.claims[0]?.judged).toMatchObject({ kind: 'source_claim', answers: { sourceSupports: 'yes', allPartsCovered: 'yes' }, spans: { found: 1, missed: 2, joined: 0, malformed: 1, strong: 1, short: 0 } })
    expect(result.claims[0]?.judged.spans.asked.map(asked => asked.text)).toEqual(['it was launched in the year 2021 by NASA', 'designed to conduct infrared astronomy'])
    expect(result.claims[1]?.judged.spans).toMatchObject({ found: 1, missed: 0 })
    expect(result.callTrace).toEqual([expect.objectContaining({ claims: [1, 2], finish: 'stop', reasoningTokens: 55, usage: expect.objectContaining({ total_tokens: 380 }) })])
  })

  it('ignores a verdict field the model sends anyway: the typed criteria decide', async () => {
    stubFetch(() => modelReply(answer({ ...j(1, 'partly', { spans: [span('designed to conduct infrared astronomy')] }), verdict: 'supported' }))())
    const res = await handler(request(body('JWST is built for infrared astronomy [1].')))
    const result = (await res.json()) as { claims: Array<{ verdict: string }> }
    expect(result.claims[0]?.verdict).toBe('partly')
  })

  it('drops an entry with a missing or invalid criterion, so that claim is not checked', async () => {
    stubFetch(() => modelReply(answer({ id: 1, kind: 'source_claim', source_supports: 'yes', subject_matches: 'maybe', cause_matches: 'yes', all_parts_covered: 'yes', spans: [span('designed to conduct infrared astronomy')] }, j(2, 'supported', { spans: [span('Its 6.5 meter primary mirror lets it see objects')] })))())
    const res = await handler(request(body()))
    const result = (await res.json()) as { claims: Array<{ verdict: string }> }
    expect(result.claims.map(claim => claim.verdict)).toEqual(['unchecked', 'supported', 'unchecked'])
  })

  it('retries a hung model call once and reports it', async () => {
    let calls = 0
    stubFetch(() => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      return modelReply(answer(j(1, 'unsupported', { reason: 'Not stated.' })))()
    })
    const res = await handler(request(body('JWST is built for infrared astronomy [1].')))
    const result = (await res.json()) as { retried?: string; claims: Array<{ verdict: string }> }
    expect(calls).toBe(2)
    expect(result.retried).toBe('timeout')
    expect(result.claims[0]?.verdict).toBe('unsupported')
  })

  it('answers a provider failure with a plain message and no provider detail', async () => {
    stubFetch(refuse(500, 'upstream exploded'))
    const res = await handler(request(body('JWST is built for infrared astronomy [1].')))
    expect(res.status).toBe(502)
    // A call was made, so the body carries usage; the provider named none, so it is empty and shows as not reported.
    expect(await res.json()).toEqual({ error: PROVIDER_TIMEOUT, usage: {}, usageGaps: 1 })
  }, 20_000)

  it('refuses a reply with no usable verdicts', async () => {
    stubFetch(() => modelReply('Sorry, I cannot do that.')())
    const res = await handler(request(body('JWST is built for infrared astronomy [1].')))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'The audit model returned no usable verdicts. Try again.' })
  })

  describe('the billed usage of a failed audit is carried on the failure', () => {
    const failure = async () => {
      const res = await handler(request(body('JWST is built for infrared astronomy [1].')))
      expect(res.status).toBe(502)
      return (await res.json()) as { error: string; usage?: Record<string, number>; usageGaps?: number }
    }

    it('cut off by length on both attempts: both attempts are summed', async () => {
      stubFetch(lengthReply(answer(j(1, 'supported', { spans: [span('designed to conduct infrared astronomy')] }))))
      const out = await failure()
      expect(out.error).toBe(LENGTH_ERROR)
      expect(out.usage).toMatchObject({ prompt_tokens: 20, completion_tokens: 8000, total_tokens: 8020 })
      expect(out.usage?.cost).toBeCloseTo(0.002, 6)
    })

    it('a reply with no usable verdicts', async () => {
      stubFetch(() => modelReply('Sorry, I cannot do that.')())
      const out = await failure()
      expect(out.error).toBe('The audit model returned no usable verdicts. Try again.')
      expect(out.usage).toEqual({ prompt_tokens: 300, completion_tokens: 80, total_tokens: 380, cost: 0.0004 })
    })

    it('a cut-off first attempt and an unusable retry: both are billed', async () => {
      let calls = 0
      stubFetch(() => (++calls === 1 ? lengthReply('{"results":[')() : modelReply('Sorry, I cannot do that.')()))
      const out = await failure()
      expect(calls).toBe(2)
      expect(out.usage).toMatchObject({ prompt_tokens: 310, completion_tokens: 4080, total_tokens: 4390 })
      expect(out.usage?.cost).toBeCloseTo(0.0014, 6)
    })

    it('a timeout before any usage arrived: usage is present and empty, so it shows as not reported', async () => {
      stubFetch(() => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      })
      const out = await failure()
      expect(out.error).toBe(PROVIDER_TIMEOUT)
      expect(out.usage).toEqual({})
      expect(out.usageGaps).toBe(1)
    })

    it('a request refused before any call carries no usage at all', async () => {
      const res = await handler(request('{"report":"x"}'))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Missing sources.' })
    })
  })

  describe('a long report is audited in parallel batches of four claims', () => {
    const SOURCES_TWO = [
      { n: 1, title: 'James Webb Space Telescope', site: 'Wikipedia', snippet: JWST },
      { n: 2, title: 'Other', site: 'Wikipedia', snippet: 'Another source says it is designed to conduct infrared astronomy too.' },
    ]
    // Nine claims, one per paragraph; claims 5 to 8 cite source 2 only.
    const NINE = Array.from({ length: 9 }, (_, i) => `Fact number ${i + 1} about the telescope [${i >= 4 && i < 8 ? 2 : 1}].`).join('\n\n')
    const nineBody = JSON.stringify({ report: NINE, sources: SOURCES_TWO })
    const idsOf = (init: RequestInit | undefined) => {
      const sent = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
      const user = sent.messages[1]?.content ?? ''
      return { user, ids: [...user.slice(user.indexOf('Claims')).matchAll(/^(\d+)\. /gm)].map(match => Number(match[1])) }
    }
    const supportedFor = (ids: number[]) => answer(...ids.map(id => j(id, 'supported', { spans: [span('designed to conduct infrared astronomy', 1)] })))

    it('sends each batch only its claims (ids stay global) and only the sources they cite, runs them at the same time, and merges the verdicts', async () => {
      let inFlight = 0
      let peak = 0
      const seen: Array<{ ids: number[]; user: string }> = []
      const fetchMock = stubFetch(async (_url, init) => {
        const { user, ids } = idsOf(init)
        seen.push({ ids, user })
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise(resolve => setTimeout(resolve, 20))
        inFlight -= 1
        return modelReply(supportedFor(ids))()
      })
      const res = await handler(request(nineBody))
      expect(res.status).toBe(200)
      const result = (await res.json()) as { claims: Array<{ id: number; verdict: string }>; usage: { total_tokens: number }; calls: unknown[]; summary: Record<string, number> }
      expect(providerCalls(fetchMock)).toHaveLength(3)
      expect(peak).toBe(3)
      // Each call's own latency is recorded: every stub waited 20 ms.
      const trace = (result as unknown as { callTrace: Array<{ ms: number }> }).callTrace
      expect(trace).toHaveLength(3)
      for (const call of trace) expect(call.ms).toBeGreaterThanOrEqual(15)
      expect(seen.map(entry => entry.ids).sort((a, b) => a[0]! - b[0]!)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]])
      const second = seen.find(entry => entry.ids[0] === 5)
      expect(second?.user).toContain('[2] Other (Wikipedia)')
      expect(second?.user).not.toContain('[1] James Webb')
      const first = seen.find(entry => entry.ids[0] === 1)
      expect(first?.user).not.toContain('[2] Other')
      expect(result.claims.map(claim => claim.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
      expect(result.usage.total_tokens).toBe(3 * 380)
      expect(result.calls).toHaveLength(3)
    })

    it('fails only the cut-off batch: its claims are not checked with the reason, the other verdicts stand, and every batch is billed', async () => {
      stubFetch(async (_url, init) => {
        const { ids } = idsOf(init)
        return ids.includes(5) ? lengthReply(supportedFor(ids))() : modelReply(supportedFor(ids))()
      })
      const res = await handler(request(nineBody))
      expect(res.status).toBe(200)
      const result = (await res.json()) as { claims: Array<{ id: number; verdict: string; reason: string }>; usage: Record<string, number>; usageGaps?: number; summary: Record<string, number>; callTrace: Array<{ claims: number[]; finish: string | null }> }
      expect(result.claims.map(claim => claim.verdict)).toEqual(['supported', 'supported', 'supported', 'supported', 'unchecked', 'unchecked', 'unchecked', 'unchecked', 'supported'])
      expect(result.claims[4]?.reason).toBe('The audit of this part ran out of reply length, so this sentence was not checked.')
      expect(result.summary).toMatchObject({ total: 9, supported: 5, unchecked: 4 })
      // Two batches finished (380 each); the third was billed for both attempts (2 x 4,010). Nothing is unreported.
      expect(result.usage).toMatchObject({ prompt_tokens: 2 * 300 + 2 * 10, completion_tokens: 2 * 80 + 2 * 4000, total_tokens: 2 * 380 + 2 * 4010 })
      expect(result.usageGaps).toBeUndefined()
      expect(result.callTrace.find(call => call.claims.includes(5))?.finish).toBe('length')
    })

    it('fails the whole audit with the error only when every batch fails, and sums the usage of all of them', async () => {
      stubFetch(async (_url, init) => lengthReply(supportedFor(idsOf(init).ids))())
      const res = await handler(request(nineBody))
      expect(res.status).toBe(502)
      const out = (await res.json()) as { error: string; usage: Record<string, number>; usageGaps?: number }
      expect(out.error).toBe(LENGTH_ERROR)
      expect(out.usage).toMatchObject({ prompt_tokens: 3 * 2 * 10, completion_tokens: 3 * 2 * 4000 })
      expect(out.usageGaps).toBeUndefined()
    })

    it('says a timed-out batch timed out, and marks the total partial: the known usage with a count of calls that reported none', async () => {
      stubFetch(async (_url, init) => {
        const { ids } = idsOf(init)
        if (ids.includes(5)) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
        return modelReply(supportedFor(ids))()
      })
      const res = await handler(request(nineBody))
      expect(res.status).toBe(200)
      const result = (await res.json()) as { claims: Array<{ verdict: string; reason: string }>; usage: Record<string, number>; usageGaps?: number }
      expect(result.claims[4]).toMatchObject({ verdict: 'unchecked', reason: 'The audit of this part timed out, so this sentence was not checked.' })
      expect(result.usage).toMatchObject({ total_tokens: 2 * 380 })
      expect(result.usageGaps).toBe(1)
    })

    it('shows a failed audit whose every call timed out as: usage empty, all calls unreported', async () => {
      stubFetch(() => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      })
      const res = await handler(request(nineBody))
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: PROVIDER_TIMEOUT, usage: {}, usageGaps: 3 })
    })

    it('keeps the verdicts of the batches that finished when one batch returns nothing usable: its claims are not checked', async () => {
      stubFetch(async (_url, init) => {
        const { ids } = idsOf(init)
        return ids.includes(9) ? modelReply('Sorry, I cannot do that.')() : modelReply(supportedFor(ids))()
      })
      const res = await handler(request(nineBody))
      expect(res.status).toBe(200)
      const result = (await res.json()) as { claims: Array<{ verdict: string }> }
      expect(result.claims.map(claim => claim.verdict)).toEqual([...Array(8).fill('supported'), 'unchecked'])
    })
  })

  it('serves a deploy preview whose Origin is the origin of its own URL', async () => {
    const res = await handler(request('{}', { origin: PREVIEW, url: `${PREVIEW}/api/audit` }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing report.' })
  })

  it('checks method, origin, body and rate limit before any model call', async () => {
    const fetchMock = stubFetch(() => modelReply('{}')())
    expect((await handler(request(undefined, { method: 'GET' }))).status).toBe(405)
    expect((await handler(request(body(), { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await handler(request(body(), { method: 'OPTIONS' }))).status).toBe(204)
    expect((await handler(request('{"report":"x"}'))).status).toBe(400)
    const ip = '203.0.113.9'
    for (let i = 0; i < 10; i += 1) await handler(request('{}', { ip }))
    const limited = await handler(request('{}', { ip }))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(SITE).toBe('https://site.example')
  })
})
