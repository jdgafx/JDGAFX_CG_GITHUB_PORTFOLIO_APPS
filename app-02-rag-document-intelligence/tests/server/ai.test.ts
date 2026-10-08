import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler from '../../netlify/functions/ai'
import { MAX_BODY_BYTES } from '../../netlify/shared/http'

const PLACEHOLDER = 'test-only-placeholder'
const ORIGIN = 'http://localhost:5173'
const CATALOGUE_URL = 'https://openrouter.ai/api/v1/models'
const SERVED = 'anthropic/claude-haiku-5-5'
const previousKey = process.env.OPENROUTER_API_KEY

const VALID = {
  question: 'In what year was the Harbor Station opened?',
  chunks: ['[Chunk 0]:\nThe port handles freight.', '[Chunk 3]:\nThe Harbor Station was opened in 1987 in Lisbon.'],
  documentTitle: 'harbor.pdf',
}

interface StepJson {
  name: string
  status: string
  detail: string
  ms: number
  tokens?: number | null
  cost?: number | null
}

interface RunJson {
  result: { answer: string; source_chunk_indices: number[]; confidence: number }
  trace: StepJson[]
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number; cost_source: string }
  model: string
  totalMs: number
}

interface ErrorJson {
  error: string
  trace?: StepJson[]
  totalMs?: number
}

interface Frame {
  type: string
  name?: string
  step?: StepJson
  run?: RunJson
  error?: string
  trace?: StepJson[]
  totalMs?: number
}

// Each request gets its own client address, so the per-address rate limit never trips here.
let clientCount = 0

// The provider stub for the test in progress. Every test starts with one that has no replies,
// so an unplanned provider call fails inside the stub and never reaches the network.
let upstream: ReturnType<typeof stubProvider>

function chatBody(content: string, options: { finish?: string; cost?: boolean } = {}) {
  const usage: Record<string, number> = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }
  if (options.cost !== false) usage['cost'] = 0.00012
  return { model: SERVED, choices: [{ finish_reason: options.finish ?? 'stop', message: { content } }], usage }
}

function jsonReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface RequestOptions {
  accept?: string
  origin?: string
  headers?: Record<string, string>
  rawBody?: string
  signal?: AbortSignal
}

function request(body: unknown, options: RequestOptions = {}): Request {
  clientCount += 1
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: options.origin ?? ORIGIN,
    Accept: options.accept ?? 'application/json',
    'x-nf-client-connection-ip': `10.1.${Math.floor(clientCount / 256)}.${clientCount % 256}`,
    ...options.headers,
  }
  return new Request('http://localhost/api/ai', {
    method: 'POST',
    headers,
    body: options.rawBody ?? JSON.stringify(body),
    signal: options.signal,
  })
}

/** Each provider call takes the next reply in order. Replies are factories, since a Response body can be read once. */
function stubProvider(...replies: Array<() => Response>) {
  const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    const next = replies.shift()
    if (!next) throw new Error('The test made an unexpected provider call.')
    return next()
  })
  vi.stubGlobal('fetch', mock)
  upstream = mock
  return mock
}

function sentBody(mock: ReturnType<typeof stubProvider>, call: number): Record<string, unknown> {
  return JSON.parse(String(mock.mock.calls[call]?.[1]?.body)) as Record<string, unknown>
}

async function readFrames(res: Response): Promise<{ frames: Frame[]; lastLine: string }> {
  const lines = (await res.text()).split('\n\n').filter(line => line !== '').map(line => line.replace(/^data: /, ''))
  return {
    frames: lines.filter(line => line !== '[DONE]').map(line => JSON.parse(line) as Frame),
    lastLine: lines.at(-1) ?? '',
  }
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = PLACEHOLDER
  vi.spyOn(console, 'error').mockImplementation(() => {})
  stubProvider()
})

afterEach(() => {
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = previousKey
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ai function: happy path', () => {
  it('answers from the cited passage and reports the served model, tokens and cost', async () => {
    const mock = stubProvider(() =>
      jsonReply(chatBody('{"answer":"The Harbor Station was opened in 1987.","source_chunk_indices":[3],"confidence":0.95}')),
    )
    const res = await handler(request(VALID))
    expect(res.status).toBe(200)
    const body = (await res.json()) as RunJson
    expect(body.result).toEqual({ answer: 'The Harbor Station was opened in 1987.', source_chunk_indices: [3], confidence: 0.95 })
    expect(body.model).toBe(SERVED)
    expect(body.usage).toMatchObject({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: 0.00012, cost_source: 'reported' })
    expect(body.trace.map(step => [step.name, step.status])).toEqual([
      ['Accept request', 'ok'],
      ['Build prompt', 'ok'],
      ['Call model', 'ok'],
      ['Parse and validate', 'ok'],
    ])
    expect(body.trace[2]?.detail).toBe(`Response from ${SERVED}.`)
    expect(body.trace[3]?.detail).toBe('Answer cites 1 passage. Self-rated 95%.')
    expect(mock).toHaveBeenCalledTimes(1)
    expect(sentBody(mock, 0)).toMatchObject({ model: '~anthropic/claude-haiku-latest', max_tokens: 4096, usage: { include: true } })
    expect(mock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${PLACEHOLDER}` })
  })

  it('streams each step as it runs, then the result, then [DONE]', async () => {
    stubProvider(() => jsonReply(chatBody('{"answer":"Opened in 1987.","source_chunk_indices":[3],"confidence":0.9}')))
    const res = await handler(request(VALID, { accept: 'text/event-stream' }))
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const { frames, lastLine } = await readFrames(res)
    expect(lastLine).toBe('[DONE]')
    expect(
      frames.map(frame => (frame.type === 'start' ? `start:${frame.name}` : frame.type === 'step' ? `step:${frame.step?.name}:${frame.step?.status}` : frame.type)),
    ).toEqual([
      'start:Accept request',
      'step:Accept request:ok',
      'start:Build prompt',
      'step:Build prompt:ok',
      'start:Call model',
      'step:Call model:ok',
      'start:Parse and validate',
      'step:Parse and validate:ok',
      'result',
    ])
    expect(frames.at(-1)?.run?.result.answer).toBe('Opened in 1987.')
    expect(frames.at(-1)?.run?.usage.total_tokens).toBe(150)
  })

  it('estimates the cost from catalogue pricing when the provider reports none', async () => {
    const catalogue = { data: [{ id: SERVED, pricing: { prompt: '0.000001', completion: '0.000005' } }] }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === CATALOGUE_URL
          ? jsonReply(catalogue)
          : jsonReply(chatBody('{"answer":"1987.","source_chunk_indices":[3],"confidence":0.7}', { cost: false })),
      ),
    )
    const res = await handler(request(VALID))
    const body = (await res.json()) as RunJson
    // 120 prompt tokens at 0.000001 plus 30 completion tokens at 0.000005.
    expect(body.usage).toMatchObject({ cost_source: 'estimated' })
    expect(body.usage.cost).toBeCloseTo(0.00027, 9)
    expect(body.trace[3]?.detail).toContain('Cost estimated from catalogue pricing.')
  })
})

describe('ai function: citations and self-rated confidence', () => {
  it('keeps only passages that were sent, once each, and clamps the rating to 100%', async () => {
    stubProvider(() => jsonReply(chatBody('{"answer":"Opened in 1987.","source_chunk_indices":[3,9,3],"confidence":1.4}')))
    const body = (await (await handler(request(VALID))).json()) as RunJson
    expect(body.result.source_chunk_indices).toEqual([3])
    expect(body.result.confidence).toBe(1)
    expect(body.trace[3]?.detail).toBe('Answer cites 1 passage. Self-rated 100%.')
  })
})

describe('ai function: retries', () => {
  it('asks again once when the first reply was cut off, and sums the tokens of both calls', async () => {
    const mock = stubProvider(
      () => jsonReply(chatBody('{"answer":"The Harbor', { finish: 'length' })),
      () => jsonReply(chatBody('{"answer":"1987.","source_chunk_indices":[3],"confidence":0.9}')),
    )
    const res = await handler(request(VALID))
    expect(res.status).toBe(200)
    const body = (await res.json()) as RunJson
    expect(mock).toHaveBeenCalledTimes(2)
    expect(body.result.answer).toBe('1987.')
    expect(body.usage.total_tokens).toBe(300)
    expect(body.trace.map(step => [step.name, step.status])).toEqual([
      ['Accept request', 'ok'],
      ['Build prompt', 'ok'],
      ['Call model', 'failed'],
      ['Retry model call', 'ok'],
      ['Parse and validate', 'ok'],
    ])
  })

  it('asks again when the reply is empty, even though the provider stopped cleanly', async () => {
    const mock = stubProvider(
      () => jsonReply(chatBody('', { finish: 'stop' })),
      () => jsonReply(chatBody('{"answer":"1987.","source_chunk_indices":[3],"confidence":0.9}')),
    )
    const res = await handler(request(VALID))
    expect(res.status).toBe(200)
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('stops after one retry when both replies are empty', async () => {
    const mock = stubProvider(() => jsonReply(chatBody('', { finish: 'stop' })), () => jsonReply(chatBody('   ', { finish: 'stop' })))
    const res = await handler(request(VALID))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'The model returned an empty response. Please try again.' })
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a provider error', async () => {
    const mock = stubProvider(() => jsonReply({ error: { message: 'Insufficient credits for acct_123' } }, 402))
    const res = await handler(request(VALID))
    expect(res.status).toBe(502)
    expect(mock).toHaveBeenCalledTimes(1)
  })
})

describe('ai function: request refusals', () => {
  it('answers 405 to GET and never calls the provider', async () => {
    const res = await handler(new Request('http://localhost/api/ai', { method: 'GET', headers: { Origin: ORIGIN } }))
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST, OPTIONS')
    expect(await res.json()).toEqual({ error: 'Method not allowed.' })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('answers 403 to an origin that is not allowed', async () => {
    const res = await handler(request(VALID, { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Origin not allowed.' })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('answers 400 with its own message for text that is not JSON', async () => {
    const res = await handler(request(undefined, { rawBody: '{"question": ' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid JSON in request body.' })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('answers 400 with its own message for a blank question', async () => {
    const res = await handler(request({ ...VALID, question: '  ' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'A question is required.' })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('answers 400 for a passage without its [Chunk N] label', async () => {
    const res = await handler(request({ ...VALID, chunks: ['No label here.'] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Each document passage must start with its [Chunk N] label.' })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('answers 413 when the declared Content-Length is over the limit', async () => {
    const res = await handler(request(VALID, { headers: { 'content-length': String(MAX_BODY_BYTES + 1) } }))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'The request is too large. Try a shorter question.' })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('answers 413 when the body is over the limit, whatever the header says', async () => {
    const res = await handler(request({ ...VALID, documentTitle: 'x'.repeat(MAX_BODY_BYTES) }))
    expect(res.status).toBe(413)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('answers 500 with a plain message when no key is configured, and never calls the provider', async () => {
    delete process.env.OPENROUTER_API_KEY
    const res = await handler(request(VALID))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'The document assistant is not configured on this deployment.' })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('answers 500 with a generic message when something unexpected throws', async () => {
    const broken = { method: 'POST', headers: { get: () => { throw new Error('headers unavailable') } } } as unknown as Request
    const res = await handler(broken)
    expect(res.status).toBe(500)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(await res.json()).toEqual({ error: 'The document assistant failed. Please try again.' })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('keeps the CORS header on the generic 500 when the origin can still be read', async () => {
    const broken = {
      method: 'POST',
      headers: {
        get: (name: string) => {
          if (name === 'origin') return ORIGIN
          throw new Error('headers unavailable')
        },
      },
    } as unknown as Request
    const res = await handler(broken)
    expect(res.status).toBe(500)
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(await res.json()).toEqual({ error: 'The document assistant failed. Please try again.' })
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe('ai function: provider failures', () => {
  it('maps a provider 402 to its plain sentence and does not copy the provider body', async () => {
    stubProvider(() => jsonReply({ error: { message: 'Insufficient credits for acct_123' } }, 402))
    const res = await handler(request(VALID))
    const text = await res.text()
    expect(res.status).toBe(502)
    expect(JSON.parse(text) as ErrorJson).toMatchObject({
      error: 'The AI provider rejected the key or is out of credit.',
      trace: [
        { name: 'Accept request', status: 'ok' },
        { name: 'Build prompt', status: 'ok' },
        { name: 'Call model', status: 'failed', detail: 'The AI provider rejected the key or is out of credit.' },
        { name: 'Parse and validate', status: 'skipped' },
      ],
    })
    expect(text).not.toContain('acct_123')
  })

  it('maps a provider 429 to status 429 with the rate-limit sentence, and does not retry', async () => {
    const mock = stubProvider(() => jsonReply({ error: { message: 'Too many requests for acct_9' } }, 429))
    const res = await handler(request(VALID))
    const text = await res.text()
    expect(res.status).toBe(429)
    expect(JSON.parse(text) as ErrorJson).toMatchObject({
      error: 'Rate limited, try again in a minute.',
      trace: [
        { name: 'Accept request', status: 'ok' },
        { name: 'Build prompt', status: 'ok' },
        { name: 'Call model', status: 'failed', detail: 'Rate limited, try again in a minute.' },
        { name: 'Parse and validate', status: 'skipped' },
      ],
    })
    expect(text).not.toContain('acct_9')
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('maps a provider 500 to the did-not-answer sentence', async () => {
    stubProvider(() => new Response('upstream exploded', { status: 500 }))
    const res = await handler(request(VALID))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'The AI provider did not answer in time.' })
  })

  it('maps a timed-out provider call (AbortError) to a 504 with the timeout sentence', async () => {
    const abort = new Error('The operation was aborted due to timeout')
    abort.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(abort)))
    const res = await handler(request(VALID))
    expect(res.status).toBe(504)
    expect(await res.json()).toMatchObject({ error: 'The AI provider did not answer in time.' })
  })

  it('answers 502 with its own message when the reply is not a usable answer', async () => {
    stubProvider(() => jsonReply(chatBody('not json at all')))
    const res = await handler(request(VALID))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'The model returned a malformed response. Please try again.' })
  })

  it('streams an error frame and then [DONE] when the provider refuses the call', async () => {
    stubProvider(() => jsonReply({ error: { message: 'Insufficient credits for acct_123' } }, 402))
    const res = await handler(request(VALID, { accept: 'text/event-stream' }))
    expect(res.status).toBe(200)
    const { frames, lastLine } = await readFrames(res)
    expect(lastLine).toBe('[DONE]')
    const last = frames.at(-1)
    expect(last?.type).toBe('error')
    expect(last?.error).toBe('The AI provider rejected the key or is out of credit.')
    expect(typeof last?.totalMs).toBe('number')
    expect(last?.trace?.map(step => [step.name, step.status])).toEqual([
      ['Accept request', 'ok'],
      ['Build prompt', 'ok'],
      ['Call model', 'failed'],
      ['Parse and validate', 'skipped'],
    ])
    expect(JSON.stringify(frames)).not.toContain('acct_123')
  })
})

describe('ai function: client disconnects', () => {
  it('cancels the upstream call when the browser goes away', async () => {
    const client = new AbortController()
    const seen: { signal?: AbortSignal } = {}
    let markCalled: () => void = () => undefined
    const called = new Promise<void>(resolve => {
      markCalled = () => resolve()
    })
    // The stub never answers. It waits for the signal the handler gives it, and rejects when that signal aborts.
    const waiting = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal ?? undefined
          seen.signal = signal
          if (signal) signal.addEventListener('abort', () => reject(signal.reason))
          markCalled()
        }),
    )
    vi.stubGlobal('fetch', waiting)
    upstream = waiting

    const pending = handler(request(VALID, { signal: client.signal }))
    await called
    client.abort()
    const res = await pending

    expect(res).toBeInstanceOf(Response)
    expect(waiting).toHaveBeenCalledTimes(1)
    expect(seen.signal?.aborted).toBe(true)
  })
})
