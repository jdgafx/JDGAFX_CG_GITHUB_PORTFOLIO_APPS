import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { config } from '../../netlify/functions/run'
import { createRunHandler } from '../../netlify/shared/handler'
import { CHECK_MODEL, EXTRACT_MODEL, SYNTH_MODEL } from '../../netlify/shared/models'

const KEY = 'test-only-placeholder'
const URL_RUN = 'https://jdgafx-app-13-langgraph-map-reduce.netlify.app/api/run'

/** Three paragraphs of about 1,000 characters: three chunks, all covered on the first pass. */
const THREE_CHUNKS = [1, 2, 3]
  .map((n) => Array.from({ length: 120 }, (_, i) => `term${n}w${i}`).join(' ') + '.')
  .join('\n')

const COST = { [EXTRACT_MODEL]: 0.000036, [CHECK_MODEL]: 0.00005, [SYNTH_MODEL]: 0.0012 }

type Behaviour = { status?: number; hang?: boolean }

function reply(model: string, content: string): Response {
  return new Response(
    JSON.stringify({
      model,
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: COST[model as keyof typeof COST] },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

/** Answers each OpenRouter call from its request body, as the provider would. Overrides fail or hang one model. */
function providerFetch(overrides: Partial<Record<string, Behaviour>> = {}) {
  return vi.fn(async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as { model: string; messages: Array<{ content: string }> }
    const behaviour = overrides[body.model]
    if (behaviour?.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }
    if (behaviour?.status) return new Response('provider detail that must not reach the user', { status: behaviour.status })
    const user = body.messages[body.messages.length - 1]?.content ?? ''
    if (body.model === EXTRACT_MODEL) {
      const id = Number(/^Chunk (\d+) of/.exec(user)?.[1])
      return reply(
        EXTRACT_MODEL,
        JSON.stringify({ points: [`Chunk ${id} sets the rule.`], entities: ['The Lessor', `Party ${id}`] }),
      )
    }
    if (body.model === CHECK_MODEL) return reply(CHECK_MODEL, JSON.stringify({ omitted: [] }))
    const ids = [...new Set([...user.matchAll(/\[chunk (\d+)\]/g)].map((m) => Number(m[1])))]
    const points = ids.map((id) => ({ text: `Chunk ${id} rule is kept.`, chunks: [id] }))
    return reply(SYNTH_MODEL, JSON.stringify({ overview: 'A lease.', sections: [{ heading: 'Terms', points }] }))
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
    expect(extracts[0]).toMatchObject({ model: EXTRACT_MODEL, usage: { total_tokens: 1200 }, costSource: 'usage' })

    const result = frames.find((f) => f.type === 'result') as { result: Record<string, unknown> } | undefined
    expect(result?.result).toMatchObject({
      coverage: { covered: [1, 2, 3], missing: [] },
      retries: 0,
      chunkCount: 3,
      findingCount: 3,
      entities: ['The Lessor', 'Party 1', 'Party 2', 'Party 3'],
    })
    const metrics = (result?.result as { metrics: Record<string, unknown> }).metrics
    expect(metrics).toMatchObject({ totalTokens: 6000, cheapCalls: 4, costSource: 'usage' })
    expect(metrics.totalCost as number).toBeCloseTo(3 * 0.000036 + 0.00005 + 0.0012, 9)
    expect(metrics.synthesisCost as number).toBeCloseTo(0.0012, 9)
    expect(metrics.cheapCost as number).toBeCloseTo(3 * 0.000036 + 0.00005, 9)
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
    const stub = providerFetch({ [EXTRACT_MODEL]: { status: 402 } })
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
    vi.stubGlobal('fetch', providerFetch({ [SYNTH_MODEL]: { status: 500 } }))

    const response = await handler(runRequest({ text: THREE_CHUNKS }))
    const body = await response.text()
    const { frames, ended } = readStream(body)

    expect(frames.at(-1)).toEqual({ type: 'error', message: 'The AI provider did not answer in time.' })
    expect(body).not.toContain('must not reach the user')
    expect(ended).toBe(true)
  })

  it('reports a timed-out synthesis call as an error frame with the plain timeout message', async () => {
    const stub = providerFetch({ [SYNTH_MODEL]: { hang: true } })
    vi.stubGlobal('fetch', stub)

    // 500 ms keeps the healthy calls safe on a loaded machine. Only the hanging call should time out.
    const response = await createRunHandler({ callTimeoutMs: 500 })(runRequest({ text: THREE_CHUNKS }))
    const { frames, ended } = readStream(await response.text())

    expect(frames.at(-1)).toEqual({ type: 'error', message: 'The AI provider did not answer in time.' })
    expect(ended).toBe(true)
    expect(stub).toHaveBeenCalled()
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
