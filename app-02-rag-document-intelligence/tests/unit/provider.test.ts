import { describe, it, expect, vi, afterEach } from 'vitest'
import { callModel, estimateCost, getProvider, MODEL, type ChatMessage } from '../../netlify/shared/provider'

const PLACEHOLDER = 'test-only-placeholder'
const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'Question: when?' }]
const FAR_FUTURE = Date.now() + 60_000
const previousKey = process.env.OPENROUTER_API_KEY

function reply(content: string, usage: Record<string, unknown> = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0001 }) {
  return new Response(
    JSON.stringify({ model: 'anthropic/claude-haiku-5-5', choices: [{ finish_reason: 'stop', message: { content } }], usage }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function fetchReturns(response: Response) {
  const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => response)
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = previousKey
})

describe('getProvider', () => {
  it('returns null when no key is configured', () => {
    expect(getProvider(MODEL)).toBeNull()
  })

  it('pins the model it is given and never reads a model from the environment', () => {
    process.env.OPENROUTER_API_KEY = PLACEHOLDER
    expect(getProvider(MODEL)).toEqual({ apiKey: PLACEHOLDER, model: '~anthropic/claude-haiku-latest' })
  })
})

describe('callModel', () => {
  const provider = { apiKey: PLACEHOLDER, model: MODEL }

  it('sends the model, an explicit output cap and usage reporting on every call', async () => {
    const mock = fetchReturns(reply('{"answer":"ok"}'))
    await callModel(provider, MESSAGES, FAR_FUTURE)
    expect(mock).toHaveBeenCalledTimes(1)
    const [url, init] = mock.mock.calls[0] ?? []
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(sent['model']).toBe('~anthropic/claude-haiku-latest')
    expect(sent['max_tokens']).toBe(4096)
    expect(sent['usage']).toEqual({ include: true })
    expect(sent['messages']).toEqual(MESSAGES)
  })

  it('returns the content, the finish reason, the served model and the usage', async () => {
    fetchReturns(reply('{"answer":"ok"}'))
    expect(await callModel(provider, MESSAGES, FAR_FUTURE)).toEqual({
      ok: true,
      content: '{"answer":"ok"}',
      finishReason: 'stop',
      model: 'anthropic/claude-haiku-5-5',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0001 },
    })
  })

  it.each([
    [401, 502, 'The AI provider rejected the key or is out of credit.'],
    [402, 502, 'The AI provider rejected the key or is out of credit.'],
    [429, 429, 'Rate limited, try again in a minute.'],
    [500, 502, 'The AI provider did not answer in time.'],
    [503, 502, 'The AI provider did not answer in time.'],
    [400, 502, 'The AI provider rejected the request.'],
  ])('maps an upstream %i to status %i and a plain sentence, and never copies the provider body', async (code, status, message) => {
    fetchReturns(new Response('{"error":"acct_123 has no credit"}', { status: code }))
    const result = await callModel(provider, MESSAGES, FAR_FUTURE)
    expect(result).toEqual({ ok: false, status, message })
    expect(JSON.stringify(result)).not.toContain('acct_123')
  })

  it.each(['AbortError', 'TimeoutError'])('maps a %s from fetch to the timeout message', async name => {
    const error = new Error('aborted')
    error.name = name
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(error)))
    expect(await callModel(provider, MESSAGES, FAR_FUTURE)).toEqual({
      ok: false,
      status: 504,
      message: 'The AI provider did not answer in time.',
    })
  })

  it('maps a network failure to a message about reaching the provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    expect(await callModel(provider, MESSAGES, FAR_FUTURE)).toEqual({
      ok: false,
      status: 502,
      message: 'Could not reach the AI provider. Try again shortly.',
    })
  })

  it('sends nothing once the shared deadline has passed', async () => {
    const mock = fetchReturns(reply('{"answer":"ok"}'))
    expect(await callModel(provider, MESSAGES, Date.now() - 1)).toEqual({
      ok: false,
      status: 504,
      message: 'The AI provider did not answer in time.',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('reports a body that is not JSON as unreadable', async () => {
    fetchReturns(new Response('not json', { status: 200 }))
    expect(await callModel(provider, MESSAGES, FAR_FUTURE)).toEqual({
      ok: false,
      status: 502,
      message: 'The AI provider returned an unreadable response.',
    })
  })

  it('maps a timeout that cuts off the reply body to the timeout message, not to unreadable', async () => {
    const timeout = new Error('The operation was aborted due to timeout')
    timeout.name = 'TimeoutError'
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(timeout)
      },
    })
    fetchReturns(new Response(body, { status: 200 }))
    expect(await callModel(provider, MESSAGES, FAR_FUTURE)).toEqual({
      ok: false,
      status: 504,
      message: 'The AI provider did not answer in time.',
    })
  })
})

describe('estimateCost', () => {
  it('prices the tokens from the catalogue when the provider reports no cost', async () => {
    const catalogue = {
      data: [{ id: 'anthropic/claude-haiku-5-5', pricing: { prompt: '0.000001', completion: '0.000005' } }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(catalogue), { status: 200 })))
    // 1000 prompt tokens at 0.000001 plus 200 completion tokens at 0.000005.
    expect(await estimateCost('anthropic/claude-haiku-5-5', 1000, 200, FAR_FUTURE)).toBeCloseTo(0.002, 9)
    expect(await estimateCost('unlisted/model', 1000, 200, FAR_FUTURE)).toBeNull()
  })

  it('skips the catalogue lookup when the deadline leaves too little time', async () => {
    vi.resetModules()
    const fresh = await import('../../netlify/shared/provider')
    const mock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', mock)
    expect(await fresh.estimateCost('anthropic/claude-haiku-5-5', 1000, 200, Date.now() + 300)).toBeNull()
    expect(mock).not.toHaveBeenCalled()
  })

  it('does not cache a catalogue reply that is not a list, so a later good reply is used', async () => {
    vi.resetModules()
    const fresh = await import('../../netlify/shared/provider')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"unexpected":true}', { status: 200 })))
    expect(await fresh.estimateCost('anthropic/claude-haiku-5-5', 1000, 200, FAR_FUTURE)).toBeNull()
    const catalogue = { data: [{ id: 'anthropic/claude-haiku-5-5', pricing: { prompt: '0.000001', completion: '0.000005' } }] }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(catalogue), { status: 200 })))
    expect(await fresh.estimateCost('anthropic/claude-haiku-5-5', 1000, 200, FAR_FUTURE)).toBeCloseTo(0.002, 9)
  })
})
