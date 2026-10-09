import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { config } from '../../netlify/functions/ai'

const PLACEHOLDER = 'test-only-placeholder'
const ORIGIN = 'https://jdgafx-app-09-ai-saas.netlify.app'
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
const SERVED_MODEL = 'anthropic/claude-haiku-5.5'
const STEP_NAMES = ['Build request', 'Call model', 'Stream answer', 'Check figures', 'Validate output']
const TIMEOUT_TEXT = 'The AI provider did not answer within 25 seconds. Try again.'
const HAPPY_TEXT = 'React rose 3.2% and averaged 32,583,774 downloads a day. It holds 62.5% of the selection.'

const REACT = { name: 'react', total: 912345678, avgPerDay: 32583774, changePct: 3.2, weekendPct: 54.1, sharePct: 62.5 }
const VUE = { name: 'vue', total: 410000000, avgPerDay: 14642857, changePct: -4.1, weekendPct: 71.3, sharePct: 28.1 }

const SUMMARY = {
  startDate: '2026-09-08',
  endDate: '2026-10-07',
  windowDays: 30,
  observedDays: 28,
  packages: [REACT, VUE],
}

interface Step {
  name: string
  status: string
  ms: number
  detail: string
  tokens?: number
  cost?: number
}

interface Frame {
  stage?: string
  step?: Step
  text?: string
  error?: string
  result?: string
  trace?: Step[]
  usage?: Record<string, number>
  model?: string | null
  totalMs?: number
}

interface Reply {
  frames: Frame[]
  done: boolean
  raw: string
}

/** Reads a whole SSE body and splits it into its frames. */
async function readReply(res: Response): Promise<Reply> {
  const raw = await res.text()
  const frames: Frame[] = []
  let done = false
  for (const block of raw.split('\n\n')) {
    const line = block.trim()
    if (!line.startsWith('data: ')) continue
    const payload = line.slice('data: '.length)
    if (payload === '[DONE]') done = true
    else frames.push(JSON.parse(payload) as Frame)
  }
  return { frames, done, raw }
}

const stepsOf = (frames: Frame[]): Step[] => frames.flatMap((f) => (f.step ? [f.step] : []))
const errorOf = (frames: Frame[]): string | undefined => frames.find((f) => f.error !== undefined)?.error

let ipCounter = 0

/** A browser-style POST from the allowed origin. Each request gets its own client, so the rate limit never bleeds between tests. */
function post(payload: unknown, headers: Record<string, string> = {}): Request {
  ipCounter += 1
  return new Request('https://site.example/api/ai', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      'x-nf-client-connection-ip': `test-client-${ipCounter}`,
      ...headers,
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl) {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

function sse(frames: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

const frame = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`
const DONE = 'data: [DONE]\n\n'

/** A provider reply whose text is split across three deltas, with the usage on the final chunk. */
function happyReply(): Response {
  return sse([
    frame({ model: SERVED_MODEL, choices: [{ delta: { content: 'React rose 3.2% ' } }] }),
    frame({ choices: [{ delta: { content: 'and averaged 32,583,774 downloads a day. ' } }] }),
    frame({ choices: [{ delta: { content: 'It holds 62.5% of the selection.' }, finish_reason: 'stop' }] }),
    frame({ choices: [], usage: { prompt_tokens: 812, completion_tokens: 240, total_tokens: 1052, cost: 0.000421 } }),
    DONE,
  ])
}

let savedKey: string | undefined

beforeEach(() => {
  savedKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = PLACEHOLDER
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = savedKey
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('netlify/functions/ai: route', () => {
  it('is served at /api/ai', () => {
    expect(config).toEqual({ path: '/api/ai' })
  })
})

describe('netlify/functions/ai: streamed run', () => {
  it('streams the text, the figure check and a done frame with the served model and usage', async () => {
    const fetchMock = stubFetch(async () => happyReply())
    const res = await handler(post({ summary: SUMMARY, model: 'openai/gpt-4o' }))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)

    const reply = await readReply(res)
    expect(reply.done).toBe(true)
    expect(reply.frames.filter((f) => f.text !== undefined).map((f) => f.text).join('')).toBe(HAPPY_TEXT)

    const steps = stepsOf(reply.frames)
    expect(steps.map((s) => [s.name, s.status])).toEqual(STEP_NAMES.map((name) => [name, 'ok']))
    expect(steps.find((s) => s.name === 'Build request')?.detail).toBe('2 packages, 2026-09-08 to 2026-10-07')
    expect(steps.find((s) => s.name === 'Call model')?.detail).toBe('OpenRouter accepted the request (HTTP 200)')
    expect(steps.find((s) => s.name === 'Stream answer')).toMatchObject({
      detail: `3 chunks, ${HAPPY_TEXT.length} characters`,
      tokens: 1052,
      cost: 0.000421,
    })
    expect(steps.find((s) => s.name === 'Check figures')?.detail).toBe('3 of 3 figures match the summary')

    const finalFrame = reply.frames.find((f) => f.stage === 'complete')
    expect(finalFrame).toMatchObject({
      result: HAPPY_TEXT,
      model: SERVED_MODEL,
      usage: { prompt_tokens: 812, completion_tokens: 240, total_tokens: 1052, cost: 0.000421 },
    })
    expect(finalFrame?.trace?.map((s) => s.name)).toEqual(STEP_NAMES)
    expect(finalFrame?.totalMs).toBeGreaterThanOrEqual(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(CHAT_URL)
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${PLACEHOLDER}` })
    const sent = JSON.parse(String(init?.body)) as { model: string; messages: { content: string }[] }
    expect(sent).toMatchObject({
      model: 'anthropic/claude-haiku-5.5',
      max_tokens: 4096,
      reasoning: { enabled: false },
      usage: { include: true },
      stream: true,
    })
    expect(sent).not.toHaveProperty('temperature')
    expect(sent.messages[0].content).toContain('- react: 912,345,678 downloads in total')
  })

  it('marks the figure check failed, and still completes, when a figure is not in the summary', async () => {
    stubFetch(async () =>
      sse([
        frame({ model: SERVED_MODEL, choices: [{ delta: { content: 'The top 12% of versions drive most installs. ' } }] }),
        frame({ choices: [{ delta: { content: 'React rose 3.2%.' }, finish_reason: 'stop' }] }),
        DONE,
      ]),
    )
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    const check = stepsOf(reply.frames).find((s) => s.name === 'Check figures')
    expect(check).toMatchObject({
      status: 'failed',
      detail: '1 of 2 figures match the summary. Not in the summary: 12%',
    })
    expect(reply.frames.find((f) => f.stage === 'complete')?.result).toBe(
      'The top 12% of versions drive most installs. React rose 3.2%.',
    )
  })

  it('flags an answer that hit the output cap, and still delivers it', async () => {
    stubFetch(async () =>
      sse([
        frame({ model: SERVED_MODEL, choices: [{ delta: { content: 'Partial answer' } }] }),
        frame({ choices: [{ delta: { content: ' cut' }, finish_reason: 'length' }] }),
        DONE,
      ]),
    )
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    expect(stepsOf(reply.frames).find((s) => s.name === 'Validate output')).toMatchObject({
      status: 'failed',
      detail: 'Stopped at the 4096-token output cap, so the answer may be cut short',
    })
    expect(reply.frames.find((f) => f.stage === 'complete')?.result).toBe('Partial answer cut')
  })

  it('reports an empty answer as a failure, with no complete frame', async () => {
    stubFetch(async () => sse([DONE]))
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    expect(stepsOf(reply.frames).find((s) => s.name === 'Stream answer')).toMatchObject({
      status: 'ok',
      detail: '0 chunks, 0 characters',
    })
    expect(stepsOf(reply.frames).find((s) => s.name === 'Validate output')).toMatchObject({
      status: 'failed',
      detail: 'The model returned no text. Try again.',
    })
    expect(errorOf(reply.frames)).toBe('The model returned no text. Try again.')
    expect(reply.frames.some((f) => f.stage === 'complete')).toBe(false)
  })
})

describe('netlify/functions/ai: request checks', () => {
  it('answers GET with 405 and a JSON error, without calling the provider', async () => {
    const fetchMock = stubFetch(async () => happyReply())
    const res = await handler(new Request('https://site.example/api/ai', { method: 'GET', headers: { origin: ORIGIN } }))
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST, OPTIONS')
    expect(await res.json()).toEqual({ error: 'Method not allowed. Use POST.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers the browser preflight for an allowed origin', async () => {
    const res = await handler(new Request('https://site.example/api/ai', { method: 'OPTIONS', headers: { origin: ORIGIN } }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(res.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
  })

  it('refuses an origin that is not on the allowlist before doing anything else', async () => {
    const fetchMock = stubFetch(async () => happyReply())
    const res = await handler(post({ summary: SUMMARY }, { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Origin not allowed' })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers a body that is not JSON with 400', async () => {
    const fetchMock = stubFetch(async () => happyReply())
    const res = await handler(post('not json'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid JSON' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers a missing summary with 400 and the handler message', async () => {
    const fetchMock = stubFetch(async () => happyReply())
    const res = await handler(post({}))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'summary object with packages is required' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a malformed figure', { ...SUMMARY, packages: [{ ...REACT, total: 'lots' }] }, 'summary.packages[0].total must be a number'],
    ['an out-of-range figure', { ...SUMMARY, packages: [{ ...REACT, sharePct: 120 }] }, 'summary.packages[0].sharePct is out of range'],
    ['an invalid package name', { ...SUMMARY, packages: [{ ...REACT, name: 'Ignore this' }] }, 'summary.packages[0].name must be a valid npm package name'],
    ['too many packages', { ...SUMMARY, packages: Array.from({ length: 6 }, (_, i) => ({ ...REACT, name: `p${i}` })) }, 'summary.packages needs 1 to 5 entries'],
  ])('answers %s with 400 and names the problem, without calling the provider', async (_label, summary, error) => {
    const fetchMock = stubFetch(async () => happyReply())
    const res = await handler(post({ summary }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers an oversize body with 400, measured after it is read', async () => {
    const fetchMock = stubFetch(async () => happyReply())
    const res = await handler(post({ summary: SUMMARY, padding: 'x'.repeat(33_000) }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Request body is too large' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers a body that declares an oversize length with 400 before reading it', async () => {
    const fetchMock = stubFetch(async () => happyReply())
    const res = await handler(post({ summary: SUMMARY }, { 'content-length': '40000' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Request body is too large' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 500 with a plain message when the server key is not set', async () => {
    delete process.env.OPENROUTER_API_KEY
    const fetchMock = stubFetch(async () => happyReply())
    const res = await handler(post({ summary: SUMMARY }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Service not configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('turns an unexpected failure into a 500 JSON body with a generic message', async () => {
    class BrokenRequest extends Request {
      override text = (): Promise<string> => {
        throw new Error('socket closed')
      }
    }
    const req = new BrokenRequest('https://site.example/api/ai', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: '{}',
    })
    const res = await handler(req)
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: 'Insight generation failed. Please try again.' })
    expect(text).not.toContain('socket closed')
  })

  it('answers the 21st request inside a minute with 429, before reading the body', async () => {
    const fetchMock = stubFetch(async () => happyReply())
    const headers = { 'x-nf-client-connection-ip': 'rate-limit-test-client' }
    for (let i = 0; i < 20; i += 1) {
      expect((await handler(post({}, headers))).status).toBe(400)
    }
    const limited = await handler(post({}, headers))
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ error: 'Too many requests. Try again in a minute.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('netlify/functions/ai: provider failures', () => {
  it('maps a provider 402 to its plain message, without the provider body', async () => {
    const fetchMock = stubFetch(async () => new Response('{"error":{"message":"Insufficient credits","code":402}}', { status: 402 }))
    const res = await handler(post({ summary: SUMMARY }))
    expect(res.status).toBe(200)
    const reply = await readReply(res)
    expect(reply.done).toBe(true)
    const steps = stepsOf(reply.frames)
    expect(steps.map((s) => [s.name, s.status])).toEqual([
      ['Build request', 'ok'],
      ['Call model', 'failed'],
      ['Stream answer', 'skipped'],
      ['Check figures', 'skipped'],
      ['Validate output', 'skipped'],
    ])
    const message = 'The AI provider is out of credit, so no analysis could be generated.'
    expect(steps[1].detail).toBe(message)
    expect(errorOf(reply.frames)).toBe(message)
    expect(reply.raw).not.toContain('Insufficient credits')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(' ')
    expect(logged).not.toContain('Insufficient credits')
  })

  it('maps a provider 500 to its plain message, without the provider body', async () => {
    stubFetch(async () => new Response('upstream exploded', { status: 500 }))
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    expect(errorOf(reply.frames)).toBe('The AI provider failed to respond. Try again shortly.')
    expect(reply.raw).not.toContain('exploded')
  })

  it('maps a provider 401 to a message that tells the owner to check the key', async () => {
    stubFetch(async () => new Response('bad key', { status: 401 }))
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    expect(errorOf(reply.frames)).toBe(
      'The AI provider rejected the server credentials. The site owner needs to check the provider key.',
    )
  })

  it('maps a rate-limit error that arrives inside the stream', async () => {
    stubFetch(async () => sse([frame({ error: { code: 429, message: 'Rate limited upstream' } }), DONE]))
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    expect(errorOf(reply.frames)).toBe('The AI provider is rate limiting requests. Try again in a minute.')
    expect(reply.raw).not.toContain('Rate limited upstream')
  })

  it('maps a provider call that the runtime aborts to the timeout message', async () => {
    stubFetch(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    })
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    expect(stepsOf(reply.frames).find((s) => s.name === 'Call model')).toMatchObject({
      status: 'failed',
      detail: TIMEOUT_TEXT,
    })
    expect(errorOf(reply.frames)).toBe(TIMEOUT_TEXT)
  })

  it('ends a provider call that never answers at the 25-second deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    stubFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      })
    }))
    const res = await handler(post({ summary: SUMMARY }))
    const pending = readReply(res)
    await vi.advanceTimersByTimeAsync(25_000)
    const reply = await pending
    expect(errorOf(reply.frames)).toBe(TIMEOUT_TEXT)
    expect(reply.done).toBe(true)
  })
})

describe('netlify/functions/ai: stream end', () => {
  const CUT_OFF_TEXT = 'The answer was cut off before it finished.'

  it('fails a stream the provider closed without [DONE] or a finish reason', async () => {
    stubFetch(async () => sse([frame({ model: SERVED_MODEL, choices: [{ delta: { content: 'React rose 3.2%' } }] })]))
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    expect(stepsOf(reply.frames).find((s) => s.name === 'Validate output')).toMatchObject({
      status: 'failed',
      detail: CUT_OFF_TEXT,
    })
    expect(errorOf(reply.frames)).toBe(CUT_OFF_TEXT)
    expect(reply.frames.some((f) => f.stage === 'complete')).toBe(false)
  })

  it('fails a stream that closed in the middle of a frame', async () => {
    stubFetch(async () =>
      sse([
        frame({ model: SERVED_MODEL, choices: [{ delta: { content: 'React rose 3.2% ' } }] }),
        'data: {"choices":[{"delta":{"content":"and latency',
      ]),
    )
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    expect(stepsOf(reply.frames).find((s) => s.name === 'Validate output')).toMatchObject({
      status: 'failed',
      detail: CUT_OFF_TEXT,
    })
    expect(errorOf(reply.frames)).toBe(CUT_OFF_TEXT)
    expect(reply.frames.some((f) => f.stage === 'complete')).toBe(false)
  })

  it('completes a stream that gave a finish reason but no [DONE]', async () => {
    stubFetch(async () =>
      sse([frame({ model: SERVED_MODEL, choices: [{ delta: { content: 'React rose 3.2%.' }, finish_reason: 'stop' }] })]),
    )
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    expect(stepsOf(reply.frames).find((s) => s.name === 'Validate output')).toMatchObject({ status: 'ok' })
    expect(reply.frames.find((f) => f.stage === 'complete')?.result).toBe('React rose 3.2%.')
  })

  it('ends a stream that never closes at the 25-second deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    stubFetch(
      async () =>
        new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    const res = await handler(post({ summary: SUMMARY }))
    const pending = readReply(res)
    await vi.advanceTimersByTimeAsync(25_000)
    const reply = await pending
    expect(stepsOf(reply.frames).find((s) => s.name === 'Stream answer')).toMatchObject({
      status: 'failed',
      detail: TIMEOUT_TEXT,
    })
    expect(errorOf(reply.frames)).toBe(TIMEOUT_TEXT)
    expect(reply.done).toBe(true)
  })
})

describe('netlify/functions/ai: one retry', () => {
  const callDetail = (reply: Reply) => stepsOf(reply.frames).find((s) => s.name === 'Call model')?.detail

  it('retries once after a connection failure and says so in the trace', async () => {
    let calls = 0
    const fetchMock = stubFetch(async () => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return happyReply()
    })
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(callDetail(reply)).toBe('OpenRouter accepted the request (HTTP 200). Retried once: the first attempt could not connect')
    expect(reply.frames.find((f) => f.stage === 'complete')?.result).toBe(HAPPY_TEXT)
  })

  it('retries once when the first attempt takes longer than 10 seconds to be accepted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let calls = 0
    const fetchMock = stubFetch((_url, init) => {
      calls += 1
      if (calls > 1) return Promise.resolve(happyReply())
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })
    })
    const pending = readReply(await handler(post({ summary: SUMMARY })))
    await vi.advanceTimersByTimeAsync(9_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    const reply = await pending
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(callDetail(reply)).toBe('OpenRouter accepted the request (HTTP 200). Retried once: the first attempt timed out after 10 seconds')
    expect(errorOf(reply.frames)).toBeUndefined()
  })

  it('makes no third attempt: two connection failures end the run', async () => {
    const fetchMock = stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(errorOf(reply.frames)).toBe('Could not reach the AI provider. Try again shortly.')
  })

  it.each([401, 402, 429, 500, 503])('never retries a provider HTTP %i', async (status) => {
    const fetchMock = stubFetch(async () => new Response('no', { status }))
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(errorOf(reply.frames)).toBeDefined()
  })

  it('does not retry when the viewer has already left', async () => {
    const fetchMock = stubFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const res = await handler(post({ summary: SUMMARY }))
    await res.body?.cancel()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('netlify/functions/ai: spike evidence', () => {
  const SPIKE = {
    name: 'react',
    date: '2026-09-28',
    downloads: 52_000_000,
    baseline: 36_000_000,
    sizePct: 44,
    releases: [{ version: '19.2.1', date: '2026-09-27', kind: 'patch' }],
    moreReleases: 0,
    releasesKnown: true,
  }

  it('puts the evidence in the prompt and checks the dates and versions of the answer against it', async () => {
    const text = 'Spikes: React reached 52,000,000 downloads on 2026-09-28, 44% over usual, just after 19.2.1 on September 20.'
    const fetchMock = stubFetch(async () =>
      sse([frame({ model: SERVED_MODEL, choices: [{ delta: { content: text }, finish_reason: 'stop' }] }), DONE]),
    )
    const reply = await readReply(await handler(post({ summary: { ...SUMMARY, spikes: [SPIKE] } })))
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { messages: { content: string }[] }
    expect(sent.messages[0].content).toContain('- react on 2026-09-28: 52,000,000 downloads, +44% against the usual 36,000,000 for that weekday')
    const check = stepsOf(reply.frames).find((s) => s.name === 'Check figures')
    expect(check).toMatchObject({ status: 'failed' })
    expect(check?.detail).toBe('4 of 5 figures match the summary and spike evidence. Not in the summary: September 20')
  })

  it('rejects evidence that does not fit the summary before any model call', async () => {
    const fetchMock = stubFetch(async () => happyReply())
    const res = await handler(post({ summary: { ...SUMMARY, spikes: [{ ...SPIKE, name: 'angular' }] } }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('netlify/functions/ai: structured claims', () => {
  const EXPLANATION = 'React holds 62.5% of the selection. It is roughly 2.2 times vue by total, and 9 times vue per day.'
  const claimsReply = (claims: string, marker = '\n===CLAIMS===\n') =>
    sse([
      frame({ model: SERVED_MODEL, choices: [{ delta: { content: EXPLANATION.slice(0, 40) } }] }),
      frame({ choices: [{ delta: { content: EXPLANATION.slice(40) + marker.slice(0, 7) } }] }),
      frame({ choices: [{ delta: { content: marker.slice(7) + claims }, finish_reason: 'stop' }] }),
      DONE,
    ])
  const GOOD = JSON.stringify([
    { q: '62.5%', k: 'share_pct', p: ['react'] },
    { q: '2.2 times', k: 'multiple', p: ['react', 'vue'], m: 'total' },
  ])

  it('shows the viewer the explanation only, and checks each claimed figure against the value it names', async () => {
    const fetchMock = stubFetch(async () => claimsReply(GOOD))
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    expect(reply.frames.filter((f) => f.text !== undefined).map((f) => f.text).join('')).toBe(EXPLANATION)
    expect(reply.raw).not.toContain('CLAIMS')
    expect(reply.frames.find((f) => f.stage === 'complete')?.result).toBe(EXPLANATION)
    const check = stepsOf(reply.frames).find((s) => s.name === 'Check figures') as Step & { check?: Record<string, unknown> }
    // 9 times is claimed by nobody; vue's per-day ratio is 2.2 too, so the sentence check cannot match it: unchecked.
    expect(check).toMatchObject({ status: 'ok', detail: '2 of 2 figures match the summary; 1 unchecked' })
    expect(check.check).toMatchObject({ checked: 2, matched: 2, rejected: [], unchecked: ['9 times'] })
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { messages: { content: string }[]; max_tokens: number }
    expect(sent.messages[0].content).toContain('===CLAIMS===')
    expect(sent.max_tokens).toBe(4096)
  })

  it('fails the check and names the figure when a claim does not match', async () => {
    const bad = JSON.stringify([{ q: '2.2 times', k: 'multiple', p: ['react', 'vue'], m: 'total' }, { q: '62.5%', k: 'change_pct', p: ['react'] }])
    stubFetch(async () => claimsReply(bad))
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    const check = stepsOf(reply.frames).find((s) => s.name === 'Check figures')
    expect(check).toMatchObject({ status: 'failed', detail: '1 of 2 figures match the summary; 1 unchecked. Not in the summary: 62.5%' })
  })

  it('falls back to reading every figure from its sentence when the claims cannot be read, and says so', async () => {
    stubFetch(async () => claimsReply('this is not json'))
    const reply = await readReply(await handler(post({ summary: SUMMARY })))
    const check = stepsOf(reply.frames).find((s) => s.name === 'Check figures')
    expect(check?.detail).toContain('The claims array could not be read')
    expect(reply.frames.find((f) => f.stage === 'complete')?.result).toBe(EXPLANATION)
  })
})
