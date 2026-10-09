import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/ai'

// Every provider call goes through this stub. No test reaches the network.
type Provider = (input: string, init?: RequestInit) => Promise<Response>

const PLACEHOLDER = 'test-only-placeholder'
const ORIGIN = 'http://localhost:5173'
const PNG = 'aGVsbG8=' // base64 of "hello"
const ORIGINAL_KEY = process.env.OPENROUTER_API_KEY
let clientCount = 0

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = PLACEHOLDER
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  if (ORIGINAL_KEY === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = ORIGINAL_KEY
})

function nextClient(): string {
  clientCount += 1
  return `10.0.0.${clientCount}`
}

function stubProvider(reply: () => Promise<Response>) {
  const mock = vi.fn<Provider>(() => reply())
  vi.stubGlobal('fetch', mock)
  return mock
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:5173/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-nf-client-connection-ip': nextClient(), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function sse(chunks: unknown[]): Response {
  const body = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

// Reads the whole SSE body, checks that it ends with [DONE], and returns the frames before it.
async function frames(response: Response): Promise<Record<string, unknown>[]> {
  const raw = await response.text()
  const blocks = raw.split('\n\n').filter(block => block !== '')
  expect(blocks.at(-1)).toBe('data: [DONE]')
  return blocks.slice(0, -1).map(block => JSON.parse(block.replace(/^data: /, '')) as Record<string, unknown>)
}

describe('POST /api/ai streamed analysis', () => {
  it('streams the answer, then a complete frame with the served model and usage', async () => {
    const provider = stubProvider(async () =>
      sse([
        { model: 'anthropic/claude-haiku-5.5', choices: [{ delta: { content: 'HELLO ' } }] },
        { choices: [{ delta: { content: '42' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 } },
      ]),
    )

    const res = await handler(
      post({
        image: PNG,
        mediaType: 'image/png',
        mode: 'qa',
        question: 'What words and number appear in this image?',
        model: 'openrouter/free',
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const out = await frames(res)
    expect(provider).toHaveBeenCalledTimes(1)
    const [url, init] = provider.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'anthropic/claude-haiku-5.5',
      max_tokens: 4096,
      reasoning: { enabled: false },
      usage: { include: true },
    })
    expect(out.filter(frame => 'text' in frame).map(frame => frame.text).join('')).toBe('HELLO 42')
    expect(out.at(-1)).toEqual({
      stage: 'complete',
      result: 'HELLO 42',
      trace: [
        { name: 'Request checked', status: 'ok', ms: expect.any(Number), detail: 'Question, image/png, about 0 KB' },
        {
          name: 'Model call',
          status: 'ok',
          ms: expect.any(Number),
          detail: 'anthropic/claude-haiku-5.5, 2 text chunks',
          tokens: 1200,
          cost: 0.0002,
        },
        { name: 'Parse and validate', status: 'ok', ms: expect.any(Number), detail: '8 characters, finish reason stop' },
      ],
      usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 },
      model: 'anthropic/claude-haiku-5.5',
      totalMs: expect.any(Number),
    })
  })

  it('blocks a moderation reply: the failed frame arrives and no text frame does', async () => {
    stubProvider(async () => sse([{ model: 'openai/content-safety-guard', choices: [{ delta: { content: 'Safe' } }] }]))

    const out = await frames(await handler(post({ image: PNG, mediaType: 'image/png', mode: 'describe' })))

    expect(out.some(frame => 'text' in frame)).toBe(false)
    expect(out.at(-1)).toMatchObject({
      stage: 'failed',
      error: 'The vision service returned no usable analysis. Please retry with the same image.',
      truncated: false,
    })
  })
})

describe('POST /api/ai request checks', () => {
  it('answers 405 to GET and never calls the provider', async () => {
    const provider = stubProvider(async () => sse([]))

    const res = await handler(new Request('http://localhost:5173/api/ai', { method: 'GET', headers: { origin: ORIGIN } }))

    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: 'Method not allowed' })
    expect(provider).not.toHaveBeenCalled()
  })

  it.each([
    ['a missing image', { mediaType: 'image/png', mode: 'describe' }, 'An image is required.'],
    [
      'a data URL in place of base64',
      { image: 'data:image/png;base64,aGVsbG8=', mediaType: 'image/png', mode: 'describe' },
      'Send the image as base64 data with its mediaType, not as a data URL.',
    ],
    [
      'a non-image media type',
      { image: PNG, mediaType: 'text/html', mode: 'describe' },
      'Unsupported image format: text/html. Use JPG, PNG, WebP, or GIF.',
    ],
    [
      'an unknown mode',
      { image: PNG, mediaType: 'image/png', mode: 'translate' },
      'Unsupported mode. Use one of: describe, analyze, qa, extract.',
    ],
    [
      'Question mode without a question',
      { image: PNG, mediaType: 'image/png', mode: 'qa' },
      'A question is required for the Question mode.',
    ],
    [
      'an image over the 4 MB limit',
      { image: 'A'.repeat(5_592_409), mediaType: 'image/png', mode: 'describe' },
      'Image is too large. Please use an image under 4MB.',
    ],
  ])('answers 400 for %s with the handler message and a failed trace step', async (_label, body, message) => {
    const provider = stubProvider(async () => sse([]))

    const res = await handler(post(body))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: message,
      trace: [{ name: 'Request checked', status: 'failed', detail: message }],
    })
    expect(provider).not.toHaveBeenCalled()
  })

  it('answers 400 for a body over 6 MB, measured in bytes, before parsing it', async () => {
    const provider = stubProvider(async () => sse([]))

    const res = await handler(post('x'.repeat(6 * 1024 * 1024 + 1)))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Image is too large. Please use an image under 4MB.' })
    expect(provider).not.toHaveBeenCalled()
  })

  it('answers 400 for a declared content length over 6 MB', async () => {
    const provider = stubProvider(async () => sse([]))

    const res = await handler(
      post({ image: PNG, mediaType: 'image/png', mode: 'describe' }, { 'content-length': String(7 * 1024 * 1024) }),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Image is too large. Please use an image under 4MB.' })
    expect(provider).not.toHaveBeenCalled()
  })

  it('answers 400 for text that is not JSON', async () => {
    const provider = stubProvider(async () => sse([]))

    const res = await handler(post('not json'))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'The request body is not valid JSON.' })
    expect(provider).not.toHaveBeenCalled()
  })

  it('answers 403 for an origin outside the allowlist', async () => {
    const provider = stubProvider(async () => sse([]))

    const res = await handler(
      post({ image: PNG, mediaType: 'image/png', mode: 'describe' }, { origin: 'https://evil.example' }),
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Origin not allowed' })
    expect(provider).not.toHaveBeenCalled()
  })

  it('answers 429 after 20 requests from one client within a minute', async () => {
    const client = nextClient()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await handler(post('not json', { 'x-nf-client-connection-ip': client }))
    }

    const res = await handler(post('not json', { 'x-nf-client-connection-ip': client }))

    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ error: 'Too many requests. Please wait a minute and try again.' })
  })

  it('answers 500 without calling the provider when the server key is not set', async () => {
    process.env.OPENROUTER_API_KEY = ''
    const provider = stubProvider(async () => sse([]))

    const res = await handler(post({ image: PNG, mediaType: 'image/png', mode: 'describe' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'The AI provider is not configured on the server.' })
    expect(provider).not.toHaveBeenCalled()
  })

  it('sends no CORS headers: the page and the function share one origin', async () => {
    const preflight = await handler(new Request('http://localhost:5173/api/ai', { method: 'OPTIONS', headers: { origin: ORIGIN } }))
    expect(preflight.status).toBe(405)
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()

    const rejected = await handler(post({ image: '', mediaType: 'image/png', mode: 'describe' }))
    expect(rejected.status).toBe(400)
    expect(rejected.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('answers a generic 500 when something unexpected fails, without leaking the cause', async () => {
    const broken = {
      method: 'POST',
      headers: {
        get: () => {
          throw new Error('internal detail 123')
        },
      },
    } as unknown as Request

    const res = await handler(broken)

    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toBe(JSON.stringify({ error: 'The analysis could not start. Please try again.' }))
    expect(text).not.toContain('internal detail')
  })
})

describe('POST /api/ai provider failures', () => {
  const body = { image: PNG, mediaType: 'image/png', mode: 'describe' }

  it('maps a provider 402 to its plain-language message and never forwards the provider body', async () => {
    const provider = stubProvider(async () => new Response('{"error":{"message":"Insufficient credits, account acct_987"}}', { status: 402 }))

    const out = await frames(await handler(post(body)))

    expect(provider).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(out)).not.toContain('acct_987')
    expect(out.at(-1)).toMatchObject({
      stage: 'failed',
      error: 'The AI provider rejected the key or is out of credit.',
      truncated: false,
    })
  })

  it('maps a provider 500 to the did-not-answer message', async () => {
    const provider = stubProvider(async () => new Response('internal provider error', { status: 500 }))

    const out = await frames(await handler(post(body)))

    expect(provider).toHaveBeenCalledTimes(1)
    expect(out.at(-1)).toMatchObject({ stage: 'failed', error: 'The AI provider did not answer in time.' })
  })

  it('maps a request the provider aborts (AbortError) to the timeout message', async () => {
    const provider = stubProvider(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    })

    const out = await frames(await handler(post(body)))

    expect(provider).toHaveBeenCalledTimes(1)
    expect(out.at(-1)).toMatchObject({ stage: 'failed', error: 'The AI provider did not answer in time.' })
  })
})
