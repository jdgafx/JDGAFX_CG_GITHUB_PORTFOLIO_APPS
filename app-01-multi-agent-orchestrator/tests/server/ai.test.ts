import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/ai'

const SITE = 'https://site.example'
const ENDPOINT = `${SITE}/.netlify/functions/ai`
const KEY = 'test-only-placeholder'
const SERVED = 'anthropic/claude-haiku-4.5'
const FIXED_MODEL = '~anthropic/claude-haiku-latest'
const QUERY = 'In two sentences, compare SSE and WebSockets for streaming LLM output.'
const VALID_BODY = JSON.stringify({ query: QUERY })
const PROVIDER_REJECTED = 'The AI provider rejected the key or is out of credit.'
const PROVIDER_TIMEOUT = 'The AI provider did not answer in time.'

type Stage = 'researcher' | 'analyst' | 'critic' | 'synthesizer'
type Frame = Record<string, unknown>

let savedKey: string | undefined
let requestCount = 0

beforeEach(() => {
  savedKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = KEY
  // A call that no test planned fails loudly instead of reaching the network.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('unplanned provider call')
    }),
  )
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = savedKey
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** A request from a fresh client address, so the per-address rate limit never interferes. */
function request(
  body: string | undefined,
  options: { method?: string; origin?: string; ip?: string; signal?: AbortSignal } = {},
): Request {
  requestCount += 1
  return new Request(ENDPOINT, {
    method: options.method ?? 'POST',
    body: options.method === 'GET' ? undefined : body,
    signal: options.signal,
    headers: {
      'content-type': 'application/json',
      origin: options.origin ?? SITE,
      'x-forwarded-host': 'site.example',
      'x-nf-client-connection-ip': options.ip ?? `198.51.100.${(requestCount % 250) + 1}`,
    },
  })
}

/** A reply body that sends nothing until its call is aborted, as a stalled connection would. */
function stalledBody(init: RequestInit | undefined): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
    },
  })
}

/** A reply that streams its text and then ends without a finish reason. */
function unfinishedReply(text: string): () => Response {
  return () =>
    new Response(`data: ${JSON.stringify({ model: SERVED, choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
}

/** Reads the whole SSE body and returns its frames. The end marker must be the last line. */
async function frames(response: Response): Promise<Frame[]> {
  const text = await response.text()
  expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true)
  return text
    .split('\n\n')
    .map(block => block.trim())
    .filter(block => block.startsWith('data: ') && block !== 'data: [DONE]')
    .map(block => JSON.parse(block.slice(6)) as Frame)
}

function stageOf(systemPrompt: string | undefined): Stage {
  if (systemPrompt?.startsWith('You are a research assistant')) return 'researcher'
  if (systemPrompt?.startsWith('You are an analyst')) return 'analyst'
  if (systemPrompt?.startsWith('You are a critic')) return 'critic'
  if (systemPrompt?.startsWith('You are a synthesis agent')) return 'synthesizer'
  throw new Error('unknown stage prompt')
}

/** Routes each provider call to the reply planned for its stage, judged from the system prompt sent. */
function plan(replies: Record<Stage, () => Response>) {
  const fetchMock = vi.fn<typeof fetch>(async (...args) => {
    const sent = JSON.parse(String(args[1]?.body)) as { messages: Array<{ content: string }> }
    return replies[stageOf(sent.messages[0]?.content)]()
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function reply(text: string, cost: number, prompt: number, completion: number): () => Response {
  return () => {
    const body =
      [
        { model: SERVED, choices: [{ delta: { content: text } }] },
        {
          model: SERVED,
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, cost },
        },
      ]
        .map(value => `data: ${JSON.stringify(value)}\n\n`)
        .join('') + 'data: [DONE]\n\n'
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
}

function refuse(status: number, body: string): () => Response {
  return () => new Response(body, { status })
}

function errorsOf(events: Frame[]): unknown[] {
  return events.filter(event => event.type === 'agent_error').map(event => event.error)
}

describe('ai function: success path', () => {
  it('streams each stage as it finishes, then one summary with trace, usage, cost and served model', async () => {
    const fetchMock = plan({
      researcher: reply('- SSE sends one-way events.\n- WebSockets are two-way.', 0.0001, 120, 40),
      analyst: reply('- One-way push fits LLM output.', 0.00008, 150, 30),
      critic: reply('- Browser support is not discussed.', 0.00005, 180, 20),
      synthesizer: reply('SSE is one-way and simpler to proxy. WebSockets are two-way and heavier.', 0.0004, 300, 90),
    })

    const res = await handler(request(VALID_BODY))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const events = await frames(res)

    expect(events.map(event => event.type)).toEqual([
      'agent_start', 'agent_chunk', 'agent_complete',
      'agent_start', 'agent_chunk', 'agent_complete',
      'agent_start', 'agent_chunk', 'agent_complete',
      'agent_start', 'agent_chunk', 'agent_complete',
      'session_complete',
    ])
    expect(events[0]).toEqual({ type: 'agent_start', agent: 'researcher', maxTokens: 600 })
    expect(events[1]).toEqual({ type: 'agent_chunk', agent: 'researcher', content: '- SSE sends one-way events.\n- WebSockets are two-way.' })
    expect(events[2]).toMatchObject({
      type: 'agent_complete',
      agent: 'researcher',
      finish: 'stop',
      servedModel: SERVED,
      usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160, cost: 0.0001 },
    })
    expect(typeof events[2]?.ms).toBe('number')
    expect(events[6]).toEqual({ type: 'agent_start', agent: 'critic', maxTokens: 400 })
    expect(events[9]).toEqual({ type: 'agent_start', agent: 'synthesizer', maxTokens: 1200 })

    const summary = events[12]
    expect(summary).toMatchObject({
      type: 'session_complete',
      agent: 'synthesizer',
      result: 'SSE is one-way and simpler to proxy. WebSockets are two-way and heavier.',
      model: SERVED,
      usage: { prompt_tokens: 750, completion_tokens: 180, total_tokens: 930, cost: expect.closeTo(0.00063, 10) },
    })
    expect(summary?.trace).toEqual([
      expect.objectContaining({ name: 'Researcher', status: 'ok', tokens: 40, cost: 0.0001 }),
      expect.objectContaining({ name: 'Analyst', status: 'ok', tokens: 30, cost: 0.00008 }),
      expect.objectContaining({ name: 'Critic', status: 'ok', tokens: 20, cost: 0.00005 }),
      expect.objectContaining({ name: 'Synthesizer', status: 'ok', tokens: 90, cost: 0.0004 }),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const sent = fetchMock.mock.calls.map(call => JSON.parse(String(call[1]?.body)) as { model: string; max_tokens: number; usage: { include: boolean } })
    expect(sent.map(body => body.max_tokens)).toEqual([600, 600, 400, 1200])
    expect(sent.every(body => body.model === FIXED_MODEL && body.usage.include)).toBe(true)
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${KEY}` })
  })

  it('reports each stage that returned no text, after one retry per stage', async () => {
    const fetchMock = plan({
      researcher: reply('', 0.00001, 10, 0),
      analyst: reply('', 0.00001, 10, 0),
      critic: reply('', 0.00001, 10, 0),
      synthesizer: reply('', 0.00001, 10, 0),
    })

    const events = await frames(await handler(request(VALID_BODY)))

    expect(errorsOf(events)).toEqual([
      'Researcher returned no text. Try again.',
      'Analyst returned no text. Try again.',
      'Critic returned no text. Try again.',
      'Synthesizer returned no text. Try again.',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(8)
  })
})

describe('ai function: provider failures', () => {
  it('maps a rejected key or missing credit to one plain sentence and never shows the provider body', async () => {
    const fetchMock = plan({
      researcher: refuse(402, '{"error":{"message":"Insufficient credits for account 123"}}'),
      analyst: refuse(402, '{"error":{"message":"Insufficient credits for account 123"}}'),
      critic: refuse(402, '{"error":{"message":"Insufficient credits for account 123"}}'),
      synthesizer: refuse(402, '{"error":{"message":"Insufficient credits for account 123"}}'),
    })

    const events = await frames(await handler(request(VALID_BODY)))

    expect(errorsOf(events)).toEqual([PROVIDER_REJECTED, PROVIDER_REJECTED, PROVIDER_REJECTED, PROVIDER_REJECTED])
    expect(JSON.stringify(events)).not.toContain('Insufficient credits')
    expect(events.at(-1)).toMatchObject({
      type: 'session_complete',
      result: '',
      trace: Array.from({ length: 4 }, () => expect.objectContaining({ status: 'failed' })),
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('retries a 500 once per stage, then reports that the provider did not answer in time', async () => {
    const fetchMock = plan({
      researcher: refuse(500, 'upstream exploded'),
      analyst: refuse(500, 'upstream exploded'),
      critic: refuse(500, 'upstream exploded'),
      synthesizer: refuse(500, 'upstream exploded'),
    })

    const events = await frames(await handler(request(VALID_BODY)))

    expect(errorsOf(events)).toEqual([PROVIDER_TIMEOUT, PROVIDER_TIMEOUT, PROVIDER_TIMEOUT, PROVIDER_TIMEOUT])
    expect(JSON.stringify(events)).not.toContain('upstream exploded')
    expect(fetchMock).toHaveBeenCalledTimes(8)
  }, 20_000)

  it('maps a provider timeout (an AbortError) to its message and does not retry it', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const events = await frames(await handler(request(VALID_BODY)))

    expect(errorsOf(events)).toEqual([PROVIDER_TIMEOUT, PROVIDER_TIMEOUT, PROVIDER_TIMEOUT, PROVIDER_TIMEOUT])
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('ai function: request handling', () => {
  it('answers GET with a 405 JSON error and calls nothing upstream', async () => {
    const res = await handler(request(undefined, { method: 'GET' }))
    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: 'Method not allowed.' })
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('answers a body that is not JSON with a 400 JSON error', async () => {
    const res = await handler(request('not json'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid JSON.' })
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('answers a missing or non-text query with a 400 JSON error', async () => {
    const missing = await handler(request('{}'))
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: 'Missing query.' })

    const numeric = await handler(request('{"query":42}'))
    expect(numeric.status).toBe(400)
    expect(await numeric.json()).toEqual({ error: 'Query must be text.' })
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('rejects an oversized body with a 400 JSON error', async () => {
    const res = await handler(request(JSON.stringify({ query: 'a'.repeat(8000), pad: 'x'.repeat(2000) })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Request body too large.' })
  })

  it('refuses an origin that is not allowed with a 403 JSON error', async () => {
    const res = await handler(request(VALID_BODY, { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Origin not allowed.' })
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('answers 500 JSON when the server has no provider key', async () => {
    process.env.OPENROUTER_API_KEY = ''
    const res = await handler(request(VALID_BODY))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'The AI service is not configured on the server.' })
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('answers an unexpected failure with a generic 500 JSON body that hides the cause', async () => {
    const broken = request(VALID_BODY)
    Object.defineProperty(broken, 'text', { value: () => Promise.reject(new Error('socket reset by peer')) })

    const res = await handler(broken)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Something went wrong on the server. Try again.' })
  })

  it('answers the eleventh request from one address with a 429 and a retry time', async () => {
    const ip = '203.0.113.99'
    for (let i = 0; i < 10; i += 1) {
      const res = await handler(request('{}', { ip }))
      expect(res.status).toBe(400)
    }

    const limited = await handler(request('{}', { ip }))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await limited.json()).toEqual({ error: 'Rate limited, try again in a minute.' })
  })
})

describe('ai function: the visitor leaves', () => {
  it('stops at once and aborts the call in flight when the visitor leaves during the first stage', async () => {
    const leave = new AbortController()
    let callStarted: (() => void) | undefined
    const firstCall = new Promise<void>(resolve => {
      callStarted = resolve
    })
    const fetchMock = vi.fn<typeof fetch>(async (...args) => {
      callStarted?.()
      return new Response(stalledBody(args[1]), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await handler(request(VALID_BODY, { signal: leave.signal }))
    await firstCall
    leave.abort()
    const events = await frames(res)

    expect(events.map(event => event.type)).toEqual(['agent_start'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  it('drops the call in flight when the visitor leaves mid-stage, and starts no later stage', async () => {
    const leave = new AbortController()
    const fetchMock = plan({
      researcher: reply('- SSE sends one-way events.', 0.0001, 120, 40),
      analyst: () => {
        leave.abort()
        return reply('- One-way push fits LLM output.', 0.00008, 150, 30)()
      },
      critic: reply('- Browser support is not discussed.', 0.00005, 180, 20),
      synthesizer: reply('SSE is one-way.', 0.0004, 300, 90),
    })

    const events = await frames(await handler(request(VALID_BODY, { signal: leave.signal })))

    expect(events.map(event => event.type)).toEqual(['agent_start', 'agent_chunk', 'agent_complete', 'agent_start'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('ai function: budget and cut-off replies', () => {
  it('skips the synthesizer when the run budget is spent before it starts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    // Every call sends its headers and then stalls, so each stage runs to its own cap.
    const fetchMock = vi.fn<typeof fetch>(
      async (...args) => new Response(stalledBody(args[1]), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const pending = frames(await handler(request(VALID_BODY)))
    await vi.runAllTimersAsync()
    const events = await pending

    expect(events.at(-2)).toMatchObject({
      type: 'agent_skipped',
      agent: 'synthesizer',
      detail: 'Not started: the run ran out of time.',
    })
    expect(events.at(-1)).toMatchObject({
      type: 'session_complete',
      trace: [
        expect.objectContaining({ name: 'Researcher', status: 'failed' }),
        expect.objectContaining({ name: 'Analyst', status: 'failed' }),
        expect.objectContaining({ name: 'Critic', status: 'failed' }),
        expect.objectContaining({ name: 'Synthesizer', status: 'skipped' }),
      ],
    })
    // Researcher and Analyst each retry once after a cut-off body. Critic gets only the 2 s left.
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('labels a reply that ends without a finish reason as cut off in the trace', async () => {
    const fetchMock = plan({
      researcher: unfinishedReply('- Partial facts with no finish.'),
      analyst: reply('- One-way push fits LLM output.', 0.00008, 150, 30),
      critic: reply('- Browser support is not discussed.', 0.00005, 180, 20),
      synthesizer: reply('SSE is one-way and simpler to proxy.', 0.0004, 300, 90),
    })

    const events = await frames(await handler(request(VALID_BODY)))

    expect(events.find(event => event.type === 'agent_complete' && event.agent === 'researcher')).toMatchObject({
      finish: 'interrupted',
    })
    expect(events.at(-1)).toMatchObject({
      type: 'session_complete',
      trace: [
        expect.objectContaining({ name: 'Researcher', status: 'cut off' }),
        expect.objectContaining({ name: 'Analyst', status: 'ok' }),
        expect.objectContaining({ name: 'Critic', status: 'ok' }),
        expect.objectContaining({ name: 'Synthesizer', status: 'ok' }),
      ],
    })
    // The researcher was retried once, so five calls in all.
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})
