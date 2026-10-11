import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { config } from '../../netlify/functions/run'
import { BUDGET_MESSAGE } from '../../netlify/shared/errors'
import { createRunHandler } from '../../netlify/shared/handler'
import { MODEL } from '../../netlify/shared/models'
import { MODELS_URL, resetPriceCache } from '../../netlify/shared/prices'
import { modelsResponse, SERVED_MODEL } from '../helpers/prices'
import { roleOf, type Role } from '../helpers/roles'

const KEY = 'test-only-placeholder'
const URL_RUN = 'https://jdgafx-app-13-langgraph-map-reduce.netlify.app/api/run'

/** Three paragraphs of about 1,000 characters: three chunks, all covered on the first pass. */
const THREE_CHUNKS = [1, 2, 3]
  .map((n) => Array.from({ length: 120 }, (_, i) => `term${n}w${i}`).join(' ') + '.')
  .join('\n')

type Behaviour = { status?: number; hang?: boolean }

/** What else the stubbed network does: the model list can be down, and a reply can leave out its model field. */
interface Network {
  priceList?: 'down'
  omitModel?: boolean
}

function reply(content: string, omitModel = false): Response {
  return new Response(
    JSON.stringify({
      ...(omitModel ? {} : { model: SERVED_MODEL }),
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

/** Answers each OpenRouter call from its request body, as the provider would. Overrides fail or hang one role. */
function providerFetch(overrides: Partial<Record<Role, Behaviour>> = {}, network: Network = {}) {
  return vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    if (url === MODELS_URL) return network.priceList === 'down' ? new Response('down', { status: 503 }) : modelsResponse()
    const body = JSON.parse(String(init.body)) as { max_tokens: number; messages: Array<{ content: string }> }
    const role = roleOf(body)
    const behaviour = overrides[role]
    if (behaviour?.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }
    if (behaviour?.status) return new Response('provider detail that must not reach the user', { status: behaviour.status })
    const user = body.messages[body.messages.length - 1]?.content ?? ''
    if (role === 'extract') {
      const id = Number(/^Chunk (\d+) of/.exec(user)?.[1])
      return reply(JSON.stringify({ points: [`Chunk ${id} sets the rule.`], entities: ['The Lessor', `Party ${id}`] }), network.omitModel)
    }
    if (role === 'check') return reply(JSON.stringify({ omitted: [] }), network.omitModel)
    const ids = [...new Set([...user.matchAll(/\[chunk (\d+)\]/g)].map((m) => Number(m[1])))]
    const points = ids.map((id) => ({ text: `Chunk ${id} rule is kept.`, chunks: [id] }))
    return reply(JSON.stringify({ overview: 'A lease.', sections: [{ heading: 'Terms', points }] }), network.omitModel)
  })
}

function runRequest(body: unknown): Request {
  return new Request(URL_RUN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Splits an SSE body into its JSON frames and reports whether the stream ended with [DONE]. */
function readStream(text: string): { frames: Array<Record<string, unknown>>; ended: boolean } {
  const blocks = text.split('\n\n').filter((b) => b.length > 0)
  const data = blocks.map((b) => b.replace(/^data: /, ''))
  return {
    frames: data.filter((d) => d !== '[DONE]').map((d) => JSON.parse(d) as Record<string, unknown>),
    ended: data[data.length - 1] === '[DONE]',
  }
}

let previousKey: string | undefined

beforeEach(() => {
  resetPriceCache()
  previousKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = KEY
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = previousKey
})

describe('POST /api/run', () => {
  it('is wired to the /api/run path', () => {
    expect(config.path).toBe('/api/run')
  })

  it('streams node frames, a result with real values and a closing [DONE] on a successful run', async () => {
    const stub = providerFetch()
    vi.stubGlobal('fetch', stub)

    const response = await handler(runRequest({ text: THREE_CHUNKS }))
    const { frames, ended } = readStream(await response.text())

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    expect(ended).toBe(true)
    expect(stub).toHaveBeenCalled()

    const nodeEnds = frames.filter((f) => f.type === 'node_end')
    expect(nodeEnds.map((f) => f.node).sort()).toEqual(
      ['check', 'extract', 'extract', 'extract', 'final', 'reduce', 'split', 'synthesize'].sort(),
    )
    expect(nodeEnds.every((f) => f.status === 'ok')).toBe(true)

    const extracts = nodeEnds.filter((f) => f.node === 'extract')
    expect(extracts.map((f) => f.detail).sort()).toEqual(['chunk 1 of 3', 'chunk 2 of 3', 'chunk 3 of 3'])
    expect(extracts[0]).toMatchObject({
      model: MODEL,
      servedModel: SERVED_MODEL,
      usage: { total_tokens: 1200 },
      priceState: 'priced',
      cost: 0.0002,
      rate: { prompt: 0.0000001, completion: 0.0000005 },
    })

    const result = frames.find((f) => f.type === 'result') as { result: Record<string, unknown> } | undefined
    expect(result?.result).toMatchObject({
      coverage: { covered: [1, 2, 3], missing: [] },
      retries: 0,
      chunkCount: 3,
      findingCount: 3,
      entities: ['The Lessor', 'Party 1', 'Party 2', 'Party 3'],
    })
    const metrics = (result?.result as { metrics: Record<string, unknown> }).metrics
    expect(metrics).toMatchObject({ totalTokens: 6000, cheapCalls: 4, priceNote: null })
    expect(metrics.totalCost as number).toBeCloseTo(5 * 0.0002, 9)
    expect(metrics.synthesisCost as number).toBeCloseTo(0.0002, 9)
    expect(metrics.cheapCost as number).toBeCloseTo(4 * 0.0002, 9)
  })

  it('fetches the public model list without a key and prices the run from it, once for the whole run', async () => {
    const stub = providerFetch()
    vi.stubGlobal('fetch', stub)

    await (await handler(runRequest({ text: THREE_CHUNKS }))).text()

    const listCalls = stub.mock.calls.filter(([url]) => url === MODELS_URL)
    expect(listCalls).toHaveLength(1)
    expect(JSON.stringify(listCalls[0][1]?.headers ?? {})).not.toMatch(/authorization/i)
  })

  it('shows tokens and "served model not reported" with no price when the reply carries no model field', async () => {
    vi.stubGlobal('fetch', providerFetch({}, { omitModel: true }))

    const { frames } = readStream(await (await handler(runRequest({ text: THREE_CHUNKS }))).text())

    const rows = frames.filter((f) => f.type === 'node_end' && f.model)
    expect(rows.length).toBe(5)
    for (const row of rows) {
      expect(row).toMatchObject({ servedModel: null, usage: { total_tokens: 1200 }, priceState: 'no-served-model' })
      expect(row).not.toHaveProperty('cost')
    }
    const result = frames.find((f) => f.type === 'result') as { result: { metrics: Record<string, unknown> } }
    expect(result.result.metrics).toMatchObject({ totalTokens: 6000, totalCost: null, priceNote: 'no-served-model' })
  })

  it('shows tokens and "price unavailable" with no fallback price when the model list cannot be fetched, and the run still finishes', async () => {
    vi.stubGlobal('fetch', providerFetch({}, { priceList: 'down' }))

    const { frames, ended } = readStream(await (await handler(runRequest({ text: THREE_CHUNKS }))).text())

    expect(ended).toBe(true)
    const rows = frames.filter((f) => f.type === 'node_end' && f.model)
    expect(rows.length).toBe(5)
    for (const row of rows) {
      expect(row).toMatchObject({ servedModel: SERVED_MODEL, usage: { total_tokens: 1200 }, priceState: 'unavailable' })
      expect(row).not.toHaveProperty('cost')
    }
    const result = frames.find((f) => f.type === 'result') as { result: { coverage: unknown; metrics: Record<string, unknown> } }
    expect(result.result.coverage).toMatchObject({ covered: [1, 2, 3], missing: [] })
    expect(result.result.metrics).toMatchObject({ totalTokens: 6000, totalCost: null, priceNote: 'unavailable' })
  })

  it('answers a GET with a plain 405 and makes no provider call', async () => {
    const stub = providerFetch()
    vi.stubGlobal('fetch', stub)

    const response = await handler(new Request(URL_RUN, { method: 'GET' }))

    expect(response.status).toBe(405)
    expect(await response.json()).toEqual({ success: false, error: 'Method not allowed.' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('answers text outside 200 to 20,000 characters with a plain 400 before the graph starts', async () => {
    const stub = providerFetch()
    vi.stubGlobal('fetch', stub)

    const response = await handler(runRequest({ text: 'too short' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Paste between 200 and 20,000 characters.',
    })
    expect(stub).not.toHaveBeenCalled()
  })

  it('reports a rejected or out-of-credit key as an error frame with the plain message', async () => {
    const stub = providerFetch({ extract: { status: 402 } })
    vi.stubGlobal('fetch', stub)

    const response = await handler(runRequest({ text: THREE_CHUNKS }))
    const { frames, ended } = readStream(await response.text())

    expect(response.status).toBe(200)
    expect(frames.filter((f) => f.type === 'error')).toEqual([
      { type: 'error', message: 'The AI provider rejected the key or is out of credit.' },
    ])
    expect(frames.at(-1)).toEqual({ type: 'error', message: 'The AI provider rejected the key or is out of credit.' })
    expect(ended).toBe(true)
  })

  it('reports a provider server error during synthesis as an error frame, without the provider text', async () => {
    vi.stubGlobal('fetch', providerFetch({ synthesize: { status: 500 } }))

    const response = await handler(runRequest({ text: THREE_CHUNKS }))
    const body = await response.text()
    const { frames, ended } = readStream(body)

    expect(frames.at(-1)).toEqual({ type: 'error', message: 'The AI provider did not answer in time.' })
    expect(body).not.toContain('must not reach the user')
    expect(ended).toBe(true)
  })

  it('reports a timed-out synthesis call as an error frame with the plain timeout message', async () => {
    const stub = providerFetch({ synthesize: { hang: true } })
    vi.stubGlobal('fetch', stub)

    // 500 ms keeps the healthy calls safe on a loaded machine. Only the hanging call should time out.
    const response = await createRunHandler({ callTimeoutMs: 500 })(runRequest({ text: THREE_CHUNKS }))
    const { frames, ended } = readStream(await response.text())

    expect(frames.at(-1)).toEqual({ type: 'error', message: 'The AI provider did not answer in time.' })
    expect(ended).toBe(true)
    expect(stub).toHaveBeenCalled()
  })

  it('finishes with the chunks it has when one extract call never answers and ignores its abort signal', async () => {
    const healthy = providerFetch()
    const deafOnChunk2 = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      const user = (JSON.parse(String(init.body)) as { messages: Array<{ content: string }> }).messages.at(-1)?.content ?? ''
      if (/^Chunk 2 of/.test(user)) return new Promise<Response>(() => undefined)
      return healthy(url, init)
    })
    vi.stubGlobal('fetch', deafOnChunk2)

    const started = Date.now()
    const response = await createRunHandler({ callTimeoutMs: 400 })(runRequest({ text: THREE_CHUNKS }))
    const { frames, ended } = readStream(await response.text())

    expect(frames.filter((f) => f.type === 'error')).toEqual([])
    const result = frames.find((f) => f.type === 'result') as { result: { coverage: Record<string, number[]>; notice: string | null } }
    expect(result.result.coverage).toEqual({ covered: [1, 3], missing: [2], noPoints: [2] })
    expect(ended).toBe(true)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('ends a run that outlives its budget with the plain budget message, then [DONE]', async () => {
    const stub = providerFetch({ extract: { hang: true } })
    vi.stubGlobal('fetch', stub)

    const response = await createRunHandler({ budgetMs: 300 })(runRequest({ text: THREE_CHUNKS }))
    const { frames, ended } = readStream(await response.text())

    expect(frames.at(-1)).toEqual({ type: 'error', message: BUDGET_MESSAGE })
    expect(frames.filter((f) => f.type === 'result')).toEqual([])
    expect(ended).toBe(true)
  })

  it('answers 503 before any provider call when no key is configured', async () => {
    delete process.env.OPENROUTER_API_KEY
    const stub = providerFetch()
    vi.stubGlobal('fetch', stub)

    const response = await handler(runRequest({ text: THREE_CHUNKS }))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ success: false, error: 'The analysis service is not configured.' })
    expect(stub).not.toHaveBeenCalled()
  })
})

describe('same-origin requests', () => {
  const PREVIEW = 'https://deploy-preview-9--jdgafx-app-13-langgraph-map-reduce.netlify.app'
  const PREVIEW_RUN = `${PREVIEW}/api/run`
  let client = 0

  /** Each request gets its own client address, so the rate limit never shares a bucket between these tests. */
  function from(url: string, origin: string | null, method: string, body?: unknown): Request {
    client += 1
    return new Request(url, {
      method,
      headers: {
        ...(origin ? { Origin: origin } : {}),
        'Content-Type': 'application/json',
        'x-nf-client-connection-ip': `203.0.113.${client}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  it('allows a deploy preview to call its own function, with CORS echoing its own origin', async () => {
    const preflight = await handler(from(PREVIEW_RUN, PREVIEW, 'OPTIONS'))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(PREVIEW)

    const post = await handler(from(PREVIEW_RUN, PREVIEW, 'POST', { text: 'too short' }))
    expect(post.status).toBe(400)
    expect(await post.json()).toMatchObject({ success: false })
  })

  it('still refuses a foreign origin, on the production URL and on a preview URL', async () => {
    const onProduction = await handler(from(URL_RUN, 'https://evil.example', 'OPTIONS'))
    expect(onProduction.status).toBe(403)
    expect(await onProduction.json()).toEqual({ success: false, error: 'Origin not allowed.' })

    const onPreview = await handler(from(PREVIEW_RUN, 'https://evil.example', 'POST', { text: 'x' }))
    expect(onPreview.status).toBe(403)
  })

  it('still allows the production origin', async () => {
    const response = await handler(from(URL_RUN, 'https://jdgafx-app-13-langgraph-map-reduce.netlify.app', 'OPTIONS'))

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://jdgafx-app-13-langgraph-map-reduce.netlify.app')
  })

  it('answers a request with no Origin header as before, with no CORS origin echoed', async () => {
    const preflight = await handler(from(URL_RUN, null, 'OPTIONS'))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull()

    const post = await handler(from(URL_RUN, null, 'POST', { text: 'too short' }))
    expect(post.status).toBe(400)
  })
})
