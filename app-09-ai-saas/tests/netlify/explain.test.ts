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
      paragraph: PARAGRAPH.paragraph,
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
      const content = JSON.stringify({ paragraph: [{ t: 'compare', package: 'react', peer: 'zod', metric: 'window_total', relation: 'higher' }] })
      expect((await reason(() => jsonResponse(chatBody({ content })))).out).toMatchObject({ ok: false, reason: 'invalid:bad-shape' })
    })
    it('carries the newest model and cost on an invalid answer too', async () => {
      const r = await reason(() => jsonResponse(chatBody({ finish: 'length' })))
      expect(r.out.newestModel).toBe('anthropic/claude-haiku-5.5')
      expect(r.out.costUsd).toBe(0.001568457)
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
      expect(await res.json()).toMatchObject({ ok: false, reason: 'model-unavailable' })
      expect(calls.filter((c) => c.url === CHAT_URL)).toHaveLength(0)
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
