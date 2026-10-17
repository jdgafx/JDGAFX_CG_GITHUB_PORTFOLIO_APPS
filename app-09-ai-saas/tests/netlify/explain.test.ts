import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_URL, KEY, ORIGIN, PARAGRAPH, chatBody, explainRequest, installFetch, jsonResponse, listBody, sentBody, wireRequest } from './helpers'
import { expectedSchema } from './expectedSchema'
import { SYSTEM_RULES, buildUserMessage, decodeRequest, encodeRequest } from '../../shared/modelInput'

type Handler = (req: Request) => Promise<Response>
type Loose = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** A fresh module graph per test, so the one-hour model-list cache never leaks between tests. */
async function load(): Promise<{ handler: Handler; config: { path: string } }> {
  vi.resetModules()
  const mod = await import('../../netlify/functions/explain')
  return { handler: mod.default as Handler, config: mod.config as { path: string } }
}

const ok = () => ({ chat: () => jsonResponse(chatBody()), list: () => jsonResponse(listBody()) })

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = KEY
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  process.env.OPENROUTER_API_KEY = ''
})

describe('POST /api/explain', () => {
  it('serves /api/explain', async () => {
    expect((await load()).config.path).toBe('/api/explain')
  })

  it('sends the exact section 3 body, built from the WP1 pieces', async () => {
    const calls = installFetch(ok())
    const { handler } = await load()
    await handler(explainRequest(wireRequest()))
    const body = sentBody(calls)
    expect(body.model).toBe('~anthropic/claude-haiku-latest')
    expect(body.reasoning).toEqual({ effort: 'medium' })
    expect(body.provider).toEqual({ require_parameters: true })
    expect(body.max_tokens).toBe(6000)
    expect(body.usage).toEqual({ include: true })
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'provider', 'reasoning', 'response_format', 'usage'])
    expect(JSON.stringify(body)).not.toContain('"enabled"')
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.name).toBe('explanation')
    expect(body.response_format.json_schema.strict).toBe(true)
    // N2: text branch, four per-kind claim branches with their patterns, compare branch.
    expect(body.response_format.json_schema.schema).toEqual(expectedSchema(['react', 'vite']))
    expect(body.messages[0]).toEqual({ role: 'system', content: SYSTEM_RULES('the past year', 'react') })
    expect(body.messages[1]).toEqual({ role: 'user', content: buildUserMessage(decodeRequest(JSON.stringify(wireRequest()))) })
  })

  it('round-trips encodeRequest through the handler with bigint values over 2^53', async () => {
    const calls = installFetch(ok())
    const req = decodeRequest(JSON.stringify(wireRequest()))
    const huge = 12345678901234567890123n
    const first = req.facts[0]!
    first.aggregates.windowTotal = huge
    first.aggregates.last30Total = huge + 1n
    first.aggregates.growth.S1 = huge + 2n
    first.aggregates.growth.S0 = huge + 3n
    const res = await (await load()).handler(explainRequest(encodeRequest(req)))
    expect(res.status).toBe(200)
    const sent = sentBody(calls).messages[1].content as string
    expect(sent).toBe(buildUserMessage(req))
    expect(sent).toContain(String(huge))
  })

  it('refuses a bigint field that is not a decimal string, or a negative one, with 400', async () => {
    const calls = installFetch(ok())
    const { handler } = await load()
    for (const bad of ['abc', '-5', '1.5', 12, { $bigint: '5' }, null]) {
      const w = wireRequest() as Loose
      w.facts[0].aggregates.windowTotal = bad
      expect((await handler(explainRequest(w))).status, JSON.stringify(bad)).toBe(400)
    }
    expect(calls).toHaveLength(0)
  })

  it('reads the key at call time and never logs it', async () => {
    const calls = installFetch({ chat: () => jsonResponse({ error: `bad key ${KEY}` }, 401), list: () => jsonResponse(listBody()) })
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined))
    const { handler } = await load()
    process.env.OPENROUTER_API_KEY = 'sk-or-changed-at-runtime'
    const res = await handler(explainRequest(wireRequest()))
    expect((calls.find((c) => c.url === CHAT_URL)?.init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-changed-at-runtime')
    const everything = JSON.stringify(spies.flatMap((s) => s.mock.calls)) + (await res.text())
    expect(everything).not.toContain(KEY)
    expect(everything).not.toContain('sk-or-changed-at-runtime')
  })

  it('returns the paragraph, served model, usage, newest model and cost', async () => {
    installFetch(ok())
    const { handler } = await load()
    const res = await handler(explainRequest(wireRequest()))
    expect(res.status).toBe(200)
    const out = (await res.json()) as Loose
    expect(out).toMatchObject({
      ok: true,
      paragraph: PARAGRAPH.shown,
      servedModel: 'anthropic/claude-haiku-5.5',
      usage: { prompt: 2863, completion: 2596, reasoning: 2068 },
      newestModel: 'anthropic/claude-haiku-5.5',
    })
    expect(out.costUsd).toBe(0.001568457)
    expect(typeof out.modelMs).toBe('number')
  })

  it('prices from the list only when the reply reports no cost, and gives null with neither', async () => {
    const noCost = { prompt_tokens: 2863, completion_tokens: 2596, completion_tokens_details: { reasoning_tokens: 2068 } }
    installFetch({ chat: () => jsonResponse(chatBody({ usage: noCost })), list: () => jsonResponse(listBody()) })
    const withList = (await (await (await load()).handler(explainRequest(wireRequest()))).json()) as Loose
    expect(withList.costUsd).toBeCloseTo(0.0015843, 10)
    installFetch({ chat: () => jsonResponse(chatBody({ usage: noCost })), list: () => jsonResponse({}, 503) })
    const withoutList = (await (await (await load()).handler(explainRequest(wireRequest()))).json()) as Loose
    expect(withoutList.costUsd).toBeNull()
  })

  it('rev 8.5: a sentence with a figure about another package, a repeated figure or no stop goes whole; the rest is sent back flat', async () => {
    const total = { t: 'claim', kind: 'window_total', package: 'react', span: 'window', day: '', value: '5765986637' }
    const content = JSON.stringify({
      paragraph: [
        { sentence: [{ t: 'text', s: 'react totals ' }, total, { t: 'text', s: ' downloads.' }] },
        { sentence: [{ t: 'text', s: 'Vite totals ' }, { ...total, package: 'vite', value: '1' }, { t: 'text', s: ' downloads, and react ' }, { ...total, kind: 'peak_value' }, { t: 'text', s: '.' }] },
        { sentence: [{ t: 'text', s: 'Again, ' }, { ...total, value: '2' }, { t: 'text', s: ' downloads.' }] },
        { sentence: [{ t: 'text', s: 'react rose' }] },
        { sentence: [{ t: 'compare', package: 'react', peer: 'vite', metric: 'window_total' }] },
      ],
    })
    installFetch({ chat: () => jsonResponse(chatBody({ content })), list: () => jsonResponse(listBody()) })
    const out = (await (await (await load()).handler(explainRequest(wireRequest()))).json()) as Loose
    expect(out.paragraph).toEqual([
      { t: 'text', s: 'react totals ' },
      total,
      { t: 'text', s: ' downloads.' },
      { t: 'text', s: ' ' },
      { t: 'compare', package: 'react', peer: 'vite', metric: 'window_total' },
    ])
  })

  it('the old flat paragraph (segments, no sentences) is invalid:bad-shape', async () => {
    const content = JSON.stringify({ paragraph: [{ t: 'text', s: 'react totals.' }] })
    installFetch({ chat: () => jsonResponse(chatBody({ content })), list: () => jsonResponse(listBody()) })
    const out = (await (await (await load()).handler(explainRequest(wireRequest()))).json()) as Loose
    expect(out).toMatchObject({ ok: false, reason: 'invalid:bad-shape' })
  })

  it('takes the target in any position among the names', async () => {
    installFetch(ok())
    const w = wireRequest() as Loose
    w.target = 'vite'
    const res = await (await load()).handler(explainRequest(w))
    expect(res.status).toBe(200)
  })

  it('reports servedModel null when the reply names no model, and newest null when the list is down', async () => {
    installFetch({ chat: () => jsonResponse(chatBody({ model: null })), list: () => jsonResponse({}, 503) })
    const { handler } = await load()
    const out = await (await handler(explainRequest(wireRequest()))).json()
    expect(out).toMatchObject({ ok: true, servedModel: null, newestModel: null, costUsd: 0.001568457 })
  })

  it('looks up the newest model alongside the call, with a 3 s limit', async () => {
    vi.useFakeTimers()
    const calls = installFetch({ chat: () => jsonResponse(chatBody()), list: () => new Promise<Response>(() => undefined) })
    const { handler } = await load()
    const pending = handler(explainRequest(wireRequest()))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.map((c) => c.url).sort()).toEqual([CHAT_URL, 'https://openrouter.ai/api/v1/models'].sort())
    await vi.advanceTimersByTimeAsync(3_000)
    const out = await (await pending).json()
    expect(out).toMatchObject({ ok: true, newestModel: null, costUsd: 0.001568457 })
  })

  it('times the model call alone, not the slower model list', async () => {
    vi.useFakeTimers()
    installFetch({ chat: () => jsonResponse(chatBody()), list: () => new Promise<Response>(() => undefined) })
    const { handler } = await load()
    const pending = handler(explainRequest(wireRequest()))
    await vi.advanceTimersByTimeAsync(3_000)
    const out = (await (await pending).json()) as Loose
    expect(out.modelMs).toBeLessThan(1_000)
  })

  it('asks the model list once for an hour', async () => {
    const calls = installFetch(ok())
    const { handler } = await load()
    await handler(explainRequest(wireRequest()))
    await handler(explainRequest(wireRequest()))
    expect(calls.filter((c) => c.url.endsWith('/models')).length).toBe(1)
  })

  describe('model answers that are not usable', () => {
    const reason = async (chat: () => Response) => {
      installFetch({ chat, list: () => jsonResponse(listBody()) })
      const { handler } = await load()
      const res = await handler(explainRequest(wireRequest()))
      return { status: res.status, out: (await res.json()) as Loose }
    }
    it('finish_reason length is invalid:cut-off, even with partial content', async () => {
      const r = await reason(() => jsonResponse(chatBody({ finish: 'length', content: '{"paragraph":[{"t":"te' })))
      expect(r.out).toMatchObject({ ok: false, reason: 'invalid:cut-off', servedModel: 'anthropic/claude-haiku-5.5' })
    })
    it('empty content is invalid:empty', async () => {
      expect((await reason(() => jsonResponse(chatBody({ content: '' })))).out).toMatchObject({ ok: false, reason: 'invalid:empty' })
      expect((await reason(() => jsonResponse(chatBody({ content: null })))).out).toMatchObject({ ok: false, reason: 'invalid:empty' })
      expect((await reason(() => jsonResponse(chatBody({ content: '   \n' })))).out).toMatchObject({ ok: false, reason: 'invalid:empty' })
    })
    it('content that is not JSON is invalid:not-json', async () => {
      expect((await reason(() => jsonResponse(chatBody({ content: 'Here is the answer' })))).out).toMatchObject({ ok: false, reason: 'invalid:not-json' })
    })
    it('JSON that is not a paragraph of segments is invalid:bad-shape', async () => {
      for (const content of ['{"other":1}', '{"paragraph":"text"}', '{"paragraph":[{"t":"text"}]}', '{"paragraph":[{"t":"claim","kind":"nope"}]}', '{"paragraph":[]}']) {
        expect((await reason(() => jsonResponse(chatBody({ content })))).out, content).toMatchObject({ ok: false, reason: 'invalid:bad-shape' })
      }
    })
    it('a package outside the request is invalid:bad-shape', async () => {
      const content = JSON.stringify({ paragraph: [{ t: 'compare', package: 'react', peer: 'zod', metric: 'window_total' }] })
      expect((await reason(() => jsonResponse(chatBody({ content })))).out).toMatchObject({ ok: false, reason: 'invalid:bad-shape' })
    })
    it('carries the newest model and cost on an invalid answer too', async () => {
      const r = await reason(() => jsonResponse(chatBody({ finish: 'length' })))
      expect(r.out.newestModel).toBe('anthropic/claude-haiku-5.5')
      expect(r.out.costUsd).toBe(0.001568457)
    })
    it('carries the usage on every kind of invalid answer, so the browser can sum it', async () => {
      const usage = { prompt: 2863, completion: 2596, reasoning: 2068 }
      expect((await reason(() => jsonResponse(chatBody({ finish: 'length' })))).out.usage).toEqual(usage)
      expect((await reason(() => jsonResponse(chatBody({ content: '' })))).out.usage).toEqual(usage)
      expect((await reason(() => jsonResponse(chatBody({ content: 'nope' })))).out.usage).toEqual(usage)
      expect((await reason(() => jsonResponse(chatBody({ content: '{"paragraph":[]}' })))).out.usage).toEqual(usage)
    })
    it('usage on an invalid answer is null when the reply reported none', async () => {
      const r = await reason(() => jsonResponse(chatBody({ finish: 'length', usage: {} })))
      expect(r.out.usage).toBeNull()
    })
  })

  describe('upstream failure is 502 model-unavailable', () => {
    const fail = async (chat: () => Response | Promise<Response>) => {
      installFetch({ chat, list: () => jsonResponse(listBody()) })
      const { handler } = await load()
      const res = await handler(explainRequest(wireRequest()))
      return { status: res.status, out: (await res.json()) as Loose }
    }
    it('on a 5xx, 4xx or 429', async () => {
      for (const status of [500, 402, 429]) {
        expect(await fail(() => jsonResponse({ error: 'x' }, status)), String(status)).toMatchObject({ status: 502, out: { ok: false, reason: 'model-unavailable', servedModel: null } })
      }
    })
    it('with no usage and no cost: nothing was reported', async () => {
      const r = await fail(() => jsonResponse({ error: 'x' }, 502))
      expect(r.out).toMatchObject({ usage: null, costUsd: null })
    })
    it('rev 8.3 cost: a request the provider refuses (401, 402, 403, 429) ran no model and costs 0; a 5xx, 408, timeout or network failure is unknown', async () => {
      for (const status of [401, 402, 403, 429]) {
        expect((await fail(() => jsonResponse({ error: 'x' }, status))).out, String(status)).toMatchObject({ ok: false, reason: 'model-unavailable', usage: null, costUsd: 0 })
      }
      for (const status of [408, 500, 502, 503]) expect((await fail(() => jsonResponse({ error: 'x' }, status))).out.costUsd, String(status)).toBeNull()
      expect((await fail(() => Promise.reject(new TypeError('fetch failed')))).out.costUsd).toBeNull()
    })
    it('on a network error', async () => {
      expect(await fail(() => Promise.reject(new TypeError('fetch failed')))).toMatchObject({ status: 502, out: { reason: 'model-unavailable' } })
    })
    it('at the 26 s timeout, even when the call ignores the abort', async () => {
      vi.useFakeTimers()
      installFetch({ chat: () => new Promise<Response>(() => undefined), list: () => jsonResponse(listBody()) })
      const { handler } = await load()
      const pending = handler(explainRequest(wireRequest()))
      await vi.advanceTimersByTimeAsync(25_999)
      let done = false
      void pending.then(() => { done = true })
      await vi.advanceTimersByTimeAsync(0)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const res = await pending
      expect(res.status).toBe(502)
      expect(await res.json()).toMatchObject({ ok: false, reason: 'model-unavailable' })
    })
    it('without a key, and makes no upstream call', async () => {
      const calls = installFetch(ok())
      const { handler } = await load()
      process.env.OPENROUTER_API_KEY = ''
      const res = await handler(explainRequest(wireRequest()))
      expect(res.status).toBe(502)
      expect(await res.json()).toMatchObject({ ok: false, reason: 'model-unavailable', costUsd: 0 }) // rev 8.3: no call was made, so nothing was charged
      expect(calls.filter((c) => c.url === CHAT_URL)).toHaveLength(0)
    })
  })

  describe('a request that cannot be turned into a prompt', () => {
    const refused = async (mutate: (w: Loose) => void) => {
      const calls = installFetch(ok())
      const { handler } = await load()
      const w = wireRequest() as Loose
      mutate(w)
      const res = await handler(explainRequest(w))
      return { status: res.status, body: (await res.json()) as Loose, calls }
    }
    it('answers 400 with the JSON error for growth computable over empty periods, never a thrown 500', async () => {
      for (const growth of [{ n0: 0 }, { n1: 0 }, { S0: '0' }]) {
        const r = await refused((w) => { Object.assign(w.facts[0].aggregates.growth, growth) })
        expect(r.status, JSON.stringify(growth)).toBe(400)
        expect(typeof r.body.error).toBe('string')
        expect(r.calls).toHaveLength(0)
      }
    })
    it('answers 400 for a target named like an Object.prototype key whose rows are omitted', async () => {
      const r = await refused((w) => {
        w.names = ['constructor']
        w.target = 'constructor'
        w.facts = [{ ...w.facts[0], name: 'constructor' }]
        w.releaseState = { constructor: 'ok' }
        delete w.pastRows
      })
      expect(r.status).toBe(400)
      expect(r.body.error).toBe('The target needs its rows.')
    })
    it('answers a package with no downloads at all: zero totals, growth not computable', async () => {
      const calls = installFetch(ok())
      const { handler } = await load()
      const w = wireRequest() as Loose
      Object.assign(w.facts[0].aggregates, { windowTotal: '0', last30Total: '0', peakValue: 0 })
      w.facts[0].aggregates.growth = { S1: '0', n1: 0, S0: '0', n0: 0, computable: false }
      w.facts[0].unusual = []
      w.pastRows.react = w.pastRows.react.map(([day]: [string]) => [day, 0, null])
      const res = await handler(explainRequest(w))
      expect(res.status).toBe(200)
      expect(sentBody(calls).messages[1].content).toContain('window_total(window)=0')
    })
    it('answers a request with a peer named constructor and no rows for it', async () => {
      const calls = installFetch(ok())
      const { handler } = await load()
      const w = wireRequest() as Loose
      w.names = ['react', 'constructor']
      w.facts = [w.facts[0], { ...w.facts[1], name: 'constructor' }]
      w.releaseState = { react: 'ok', constructor: 'ok' }
      w.pastRows = { react: w.pastRows.react }
      const res = await handler(explainRequest(w))
      expect(res.status).toBe(200)
      expect(calls.filter((c) => c.url === CHAT_URL)).toHaveLength(1)
    })
    it('answers a clear JSON error when building the prompt throws, and makes no upstream call', async () => {
      const calls = installFetch(ok())
      vi.resetModules()
      vi.doMock('../../shared/modelInput', async (orig) => ({
        ...(await orig<typeof import('../../shared/modelInput')>()),
        buildUserMessage: () => {
          throw new RangeError('Division by zero')
        },
      }))
      try {
        const handler = (await import('../../netlify/functions/explain')).default as Handler
        const res = await handler(explainRequest(wireRequest()))
        expect(res.status).toBe(400)
        expect(res.headers.get('content-type')).toContain('application/json')
        expect(await res.json()).toEqual({ error: 'The request could not be turned into a prompt.' })
        expect(calls.filter((c) => c.url === CHAT_URL)).toHaveLength(0)
      } finally {
        vi.doUnmock('../../shared/modelInput')
      }
    })
  })

  describe('rate limit', () => {
    const from = (ip: string) => explainRequest(wireRequest(), { 'x-nf-client-connection-ip': ip })
    it('answers the 21st request in a minute from one client with 429 and a JSON error, before reading the body or calling the model', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const calls = installFetch(ok())
      const { handler } = await load()
      for (let i = 0; i < 20; i++) expect((await handler(from('203.0.113.7'))).status, `request ${i + 1}`).toBe(200)
      const chatBefore = calls.filter((c) => c.url === CHAT_URL).length
      const res = await handler(from('203.0.113.7'))
      expect(res.status).toBe(429)
      expect(res.headers.get('content-type')).toContain('application/json')
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
      expect(((await res.json()) as Loose).error).toMatch(/too many requests/i)
      expect(calls.filter((c) => c.url === CHAT_URL)).toHaveLength(chatBefore)
      // another client is not held back, and the first is let in again after the minute
      expect((await handler(from('203.0.113.8'))).status).toBe(200)
      vi.setSystemTime(Date.now() + 60_001)
      expect((await handler(from('203.0.113.7'))).status).toBe(200)
    })
    it('counts a request the boundary refuses, so junk cannot be sent for free', async () => {
      installFetch(ok())
      const { handler } = await load()
      for (let i = 0; i < 20; i++) expect((await handler(explainRequest('not json', { 'x-nf-client-connection-ip': '198.51.100.1' }))).status).toBe(400)
      expect((await handler(explainRequest('not json', { 'x-nf-client-connection-ip': '198.51.100.1' }))).status).toBe(429)
    })
  })

  describe('boundary', () => {
    const status = async (req: Request) => {
      const calls = installFetch(ok())
      const { handler } = await load()
      const res = await handler(req)
      return { status: res.status, calls }
    }
    it('answers 400 for more than 4 names', async () => {
      const w = wireRequest() as Loose
      w.names = ['react', 'vite', 'zod', 'esbuild', 'webpack']
      const r = await status(explainRequest(w))
      expect(r.status).toBe(400)
      expect(r.calls).toHaveLength(0)
    })
    it('answers 400 for a body over 32 KB', async () => {
      const w = wireRequest() as Loose
      w.pad = 'x'.repeat(33 * 1024)
      const r = await status(explainRequest(w))
      expect(r.status).toBe(400)
      expect(r.calls).toHaveLength(0)
    })
    it('answers 400 for bad JSON and for a bad row', async () => {
      expect((await status(explainRequest('{nope'))).status).toBe(400)
      expect((await status(explainRequest(''))).status).toBe(400)
      const w = wireRequest() as Loose
      w.pastRows.react = [['2026-09-12', -3, null]]
      expect((await status(explainRequest(w))).status).toBe(400)
    })
    it('answers 403 to a cross-site origin and 405 to GET, with no upstream call', async () => {
      const cross = await status(explainRequest(wireRequest(), { origin: 'https://evil.example' }))
      expect(cross.status).toBe(403)
      expect(cross.calls).toHaveLength(0)
      expect((await status(explainRequest(null, {}, 'GET'))).status).toBe(405)
    })
    it('accepts the production origin, no origin and the request\'s own origin', async () => {
      expect((await status(explainRequest(wireRequest(), { origin: ORIGIN }))).status).toBe(200)
      expect((await status(explainRequest(wireRequest()))).status).toBe(200)
      expect((await status(explainRequest(wireRequest(), { origin: 'https://site.test' }))).status).toBe(200)
    })
  })
})
