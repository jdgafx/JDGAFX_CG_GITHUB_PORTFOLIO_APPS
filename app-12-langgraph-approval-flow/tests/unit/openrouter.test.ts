import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODEL } from '../../netlify/shared/models'
import {
  CALL_TIMEOUT_MS,
  PROVIDER_BAD_REPLY,
  PROVIDER_BUSY,
  PROVIDER_NOT_CONFIGURED,
  PROVIDER_REJECTED,
  PROVIDER_REQUEST,
  PROVIDER_SLOW,
  PROVIDER_TIMEOUT,
  PROVIDER_UNREACHABLE,
  ProviderError,
  chat,
  parseChatReply,
  providerFailure,
  requestBody,
  type ChatRequest,
} from '../../netlify/shared/openrouter'

const REQUEST: ChatRequest = {
  model: MODEL,
  maxTokens: 300,
  json: true,
  messages: [
    { role: 'system', content: 'Extract.' },
    { role: 'user', content: 'Issue text' },
  ],
}

describe('parseChatReply', () => {
  it('reads the text, the finish reason, the served model and the reported usage with cost', () => {
    const reply = parseChatReply({
      model: 'anthropic/claude-haiku-5.5-served',
      choices: [{ message: { content: '  {"issue":"other"}  ' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.00036 },
    })
    expect(reply).toEqual({
      text: '{"issue":"other"}',
      finishReason: 'stop',
      servedModel: 'anthropic/claude-haiku-5.5-served',
      usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.00036 },
    })
  })

  it('reports nothing it was not given: no served model, no cost, empty text', () => {
    const reply = parseChatReply({ choices: [{ message: {} }] })
    expect(reply.text).toBe('')
    expect(reply.servedModel).toBeUndefined()
    expect(reply.finishReason).toBeNull()
    expect(reply.usage).toEqual({})
  })

  it('survives a body that is not an object', () => {
    expect(parseChatReply(null)).toMatchObject({ text: '', usage: {} })
    expect(parseChatReply('nope')).toMatchObject({ text: '', usage: {} })
  })
})

describe('requestBody', () => {
  it('always sends max_tokens and asks for usage accounting, with a JSON reply only when asked', () => {
    const body = requestBody(REQUEST)
    expect(body).toMatchObject({
      model: MODEL,
      max_tokens: 300,
      usage: { include: true },
      response_format: { type: 'json_object' },
    })
    expect(requestBody({ ...REQUEST, json: false })).not.toHaveProperty('response_format')
  })

  it('always routes only to providers that accept every parameter, and always turns reasoning off', () => {
    expect(requestBody(REQUEST)).toMatchObject({
      provider: { require_parameters: true },
      reasoning: { enabled: false },
    })
    expect(requestBody({ ...REQUEST, json: false })).toMatchObject({ provider: { require_parameters: true } })
  })

  it('never sends a temperature: Haiku 5.5 rejects it next to require_parameters with a 404', () => {
    const body = requestBody(REQUEST)
    expect(body).not.toHaveProperty('temperature')
    expect(JSON.stringify(body)).not.toContain('temperature')
    expect(body).toMatchObject({ model: 'anthropic/claude-haiku-5.5' })
  })
})

describe('providerFailure', () => {
  it.each([
    [401, PROVIDER_REJECTED],
    [402, PROVIDER_REJECTED],
    [403, PROVIDER_REJECTED],
    [429, PROVIDER_BUSY],
    [500, PROVIDER_SLOW],
    [503, PROVIDER_SLOW],
    [400, PROVIDER_REQUEST],
  ])('maps HTTP %i to a plain message', (status, message) => {
    const error = providerFailure(status)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error.status).toBe(status)
    expect(error.message).toBe(message)
  })
})

describe('chat', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
  })

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = ''
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function replyOnce(status: number, body: unknown) {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify(body), { status }))
    vi.stubGlobal('fetch', fetchStub)
    return fetchStub
  }

  it('returns the parsed reply and sends the key only in the Authorization header', async () => {
    const fetchStub = replyOnce(200, {
      model: MODEL,
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { total_tokens: 5 },
    })

    const result = await chat(REQUEST, new AbortController().signal)

    expect(result.text).toBe('ok')
    expect(fetchStub).toHaveBeenCalledTimes(1)
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-only-placeholder')
    expect(JSON.parse(String(init.body))).toMatchObject({ max_tokens: 300, usage: { include: true } })
  })

  it('maps a 402 reply to the plain key-or-credit message', async () => {
    replyOnce(402, { error: { message: 'raw provider text that must not leak' } })
    await expect(chat(REQUEST, new AbortController().signal)).rejects.toMatchObject({
      status: 402,
      message: PROVIDER_REJECTED,
    })
  })

  it('maps a 500 reply to the did-not-answer message', async () => {
    replyOnce(500, {})
    await expect(chat(REQUEST, new AbortController().signal)).rejects.toThrow(PROVIDER_SLOW)
  })

  it('maps a network failure to the could-not-reach message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    await expect(chat(REQUEST, new AbortController().signal)).rejects.toThrow(PROVIDER_UNREACHABLE)
  })

  it('maps a reply that is not JSON to the could-not-read message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 200 })))
    await expect(chat(REQUEST, new AbortController().signal)).rejects.toThrow(PROVIDER_BAD_REPLY)
  })

  /** A fetch that never settles and ignores its abort signal, so only a timer of ours can end the call. */
  const deaf = () => vi.fn(() => new Promise<Response>(() => {}))

  /** A reply whose headers arrive but whose body never finishes, and which ignores its abort signal. */
  const stuckBody = () =>
    vi.fn(async () => new Response(new ReadableStream({ start() {} }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

  it('gives up after the call limit, even when the fetch ignores its abort signal, and says it was the call', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', deaf())
    const assertion = expect(chat(REQUEST, new AbortController().signal)).rejects.toMatchObject({
      status: 504,
      kind: 'timeout',
      message: PROVIDER_TIMEOUT,
    })
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS)
    await assertion
    expect(PROVIDER_TIMEOUT).toBe('The AI provider did not answer within 12 seconds.')
  })

  it('cuts a reply whose body never finishes at the call limit', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', stuckBody())
    const assertion = expect(chat(REQUEST, new AbortController().signal)).rejects.toMatchObject({ kind: 'timeout', message: PROVIDER_TIMEOUT })
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS - 1)
    await vi.advanceTimersByTimeAsync(1)
    await assertion
  })

  it('stops at once when the run budget is aborted, and says it was the budget, not the call', async () => {
    vi.stubGlobal('fetch', deaf())
    const budget = new AbortController()
    const pending = chat(REQUEST, budget.signal)
    budget.abort()
    await expect(pending).rejects.toMatchObject({ status: 504, kind: 'budget', message: PROVIDER_SLOW })
  })

  it('stops at once when the run budget is already over, without a call timeout', async () => {
    const fetchStub = deaf()
    vi.stubGlobal('fetch', fetchStub)
    const budget = new AbortController()
    budget.abort()
    await expect(chat(REQUEST, budget.signal)).rejects.toMatchObject({ kind: 'budget' })
  })

  it('leaves no timer behind after a reply, so a finished call cannot fail later', async () => {
    vi.useFakeTimers()
    replyOnce(200, { choices: [{ message: { content: 'ok' } }] })
    await chat(REQUEST, new AbortController().signal)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refuses to call the provider when no key is configured', async () => {
    process.env.OPENROUTER_API_KEY = ''
    const fetchStub = replyOnce(200, {})
    await expect(chat(REQUEST, new AbortController().signal)).rejects.toThrow(PROVIDER_NOT_CONFIGURED)
    expect(fetchStub).not.toHaveBeenCalled()
  })
})
