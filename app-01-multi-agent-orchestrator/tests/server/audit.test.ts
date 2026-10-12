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
const LENGTH_ERROR = 'The audit ran out of reply length before it finished. Try again.'

describe('audit function', () => {
  it('judges every cited sentence with one model call, with the preceding sentence as context, and checks each span word for word', async () => {
    const fetchMock = stubFetch(async (_url, init) => {
      const sent = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }>; temperature?: number }
      expect(sent.model).toBe(FIXED_MODEL)
      expect('temperature' in sent).toBe(false)
      expect(sent.messages[1]?.content).toContain('1. JWST is built for infrared astronomy [1].')
      expect(sent.messages[1]?.content).toContain('2. Its primary mirror is 9 metres wide [1].\n   Context: JWST is built for infrared astronomy.')
      expect(sent.messages[1]?.content).toContain('3. Bananas are rich in potassium and grow in tropical regions [1].')
      return modelReply(
        answer(
          { id: 1, verdict: 'supported', spans: [span('designed to conduct infrared astronomy')], reason: 'Stated.' },
          { id: 2, verdict: 'partly', spans: [span('Its 6.5 meter primary mirror lets it see objects')], uncovered: 'the 9 metre width', reason: 'Source says 6.5 meter.' },
          { id: 3, verdict: 'unsupported', reason: 'Not about the telescope.' },
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
    expect(result.summary).toEqual({ total: 3, supported: 1, partly: 1, unsupported: 1, unchecked: 0, unverified: 0 })
    expect(result.usage.total_tokens).toBe(380)
    expect(result.model).toEqual({ servedModel: SERVED, newestModel: SERVED, modelCheck: 'match' })
  })

  it('shows a supported verdict whose span is not in the source as unverified, and a sentence the model skipped as not checked', async () => {
    stubFetch(() => modelReply(answer({ id: 1, verdict: 'supported', spans: [span('it was launched in the year 2021 by NASA')], reason: 'x' }))())
    const res = await handler(request(body()))
    const result = (await res.json()) as { claims: Array<{ verdict: string; quotes?: unknown; reason: string }>; summary: Record<string, number> }
    expect(result.claims.map(claim => claim.verdict)).toEqual(['unverified', 'unchecked', 'unchecked'])
    expect(result.claims[0]?.quotes).toBeUndefined()
    expect(result.claims[0]?.reason).toContain('not found in the source')
    expect(result.summary).toMatchObject({ unverified: 1, unchecked: 2, supported: 0 })
  })

  it('shows a judgment whose reply named no model as not reported, never as the requested alias', async () => {
    stubFetch(unnamedReply(answer({ id: 1, verdict: 'supported', spans: [span('designed to conduct infrared astronomy')], reason: 'Stated.' })))
    const res = await handler(request(body()))
    const result = (await res.json()) as { model: unknown }
    expect(result.model).toEqual({ servedModel: null, newestModel: SERVED, modelCheck: 'not-reported' })
  })

  it.each([
    ['length', lengthReply],
    ['no finish reason', unfinishedReply],
  ])('stops with a visible error and uses no verdict when the final attempt ends with %s, even if the JSON is complete', async (_name, cutOff) => {
    const fetchMock = stubFetch(
      cutOff(answer({ id: 1, verdict: 'supported', spans: [span('designed to conduct infrared astronomy')], reason: 'Stated.' }, { id: 2, verdict: 'supported', spans: [span('Its 6.5 meter primary mirror lets it see objects')] })),
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
        ? lengthReply(answer({ id: 1, verdict: 'unsupported', reason: 'a longer first attempt, cut off, with a verdict that must not be used' }))()
        : modelReply(answer({ id: 1, verdict: 'supported', spans: [span('designed to conduct infrared astronomy')], reason: 'Stated.' }))()
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

  it('retries a hung model call once and reports it', async () => {
    let calls = 0
    stubFetch(() => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      return modelReply(answer({ id: 1, verdict: 'unsupported', reason: 'Not stated.' }))()
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
    expect(await res.json()).toEqual({ error: PROVIDER_TIMEOUT })
  }, 20_000)

  it('refuses a reply with no usable verdicts', async () => {
    stubFetch(() => modelReply('Sorry, I cannot do that.')())
    const res = await handler(request(body('JWST is built for infrared astronomy [1].')))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'The audit model returned no usable verdicts. Try again.' })
  })

  it('serves a deploy preview whose Origin is the origin of its own URL', async () => {
    const res = await handler(request('{}', { origin: PREVIEW, url: `${PREVIEW}/.netlify/functions/audit` }))
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
