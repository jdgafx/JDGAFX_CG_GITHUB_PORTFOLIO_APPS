import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CALL_TIMEOUT_MS,
  PROVIDER_BAD_REPLY,
  PROVIDER_BUSY,
  PROVIDER_NOT_CONFIGURED,
  PROVIDER_REJECTED,
  PROVIDER_REQUEST,
  PROVIDER_SLOW,
  PROVIDER_UNREACHABLE,
  ProviderError,
  chat,
  parseChatReply,
  providerFailure,
  requestBody,
  type ChatRequest,
} from '../../netlify/shared/openrouter'

const REQUEST: ChatRequest = {
  model: 'xiaomi/mimo-v2.6-flash',
  maxTokens: 300,
  temperature: 0,
  json: true,
  messages: [
    { role: 'system', content: 'Extract.' },
    { role: 'user', content: 'Ticket text' },
  ],
}

describe('parseChatReply', () => {
  it('reads the text, the finish reason, the served model and the reported usage with cost', () => {
    const reply = parseChatReply({
      model: 'xiaomi/mimo-v2.6-flash-served',
      choices: [{ message: { content: '  {"issue":"other"}  ' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.00036 },
    })
    expect(reply).toEqual({
      text: '{"issue":"other"}',
      toolCalls: [],
      finishReason: 'stop',
      servedModel: 'xiaomi/mimo-v2.6-flash-served',
      usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.00036 },
    })
  })

  it('reads tool calls and parses their JSON arguments, and a broken argument string becomes null', () => {
    const reply = parseChatReply({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'lookup_order', arguments: '{"orderId":"ORD-1042"}' } },
              { id: 'call_2', type: 'function', function: { name: 'lookup_order', arguments: '{broken' } },
              { id: 'call_3', type: 'other' },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    })
    expect(reply.text).toBe('')
    expect(reply.finishReason).toBe('tool_calls')
    expect(reply.toolCalls).toEqual([
      { id: 'call_1', name: 'lookup_order', args: { orderId: 'ORD-1042' } },
      { id: 'call_2', name: 'lookup_order', args: null },
    ])
  })

  it('reports nothing it was not given: no served model, no cost, empty text', () => {
    const reply = parseChatReply({ choices: [{ message: {} }] })
    expect(reply.text).toBe('')
    expect(reply.servedModel).toBeUndefined()
    expect(reply.finishReason).toBeNull()
    expect(reply.usage).toEqual({})
  })

  it('survives a body that is not an object', () => {
    expect(parseChatReply(null)).toMatchObject({ text: '', toolCalls: [], usage: {} })
    expect(parseChatReply('nope')).toMatchObject({ text: '', toolCalls: [], usage: {} })
  })
})

describe('requestBody', () => {
  it('always sends max_tokens and asks for usage accounting, with a JSON reply only when asked', () => {
    const body = requestBody(REQUEST)
    expect(body).toMatchObject({
      model: 'xiaomi/mimo-v2.6-flash',
      max_tokens: 300,
      temperature: 0,
      usage: { include: true },
      response_format: { type: 'json_object' },
    })
    expect(requestBody({ ...REQUEST, json: false })).not.toHaveProperty('response_format')
  })

  it('leaves out the provider routing rule only for a call that opts out of it', () => {
    expect(requestBody({ ...REQUEST, requireParameters: false })).not.toHaveProperty('provider')
    expect(requestBody({ ...REQUEST, requireParameters: false })).toMatchObject({ reasoning: { enabled: false } })
    expect(requestBody(REQUEST)).toMatchObject({
      provider: { require_parameters: true },
      reasoning: { enabled: false },
    })
  })

  it('adds tools with auto tool choice when tools are given', () => {
    const tools = [{ type: 'function' as const, function: { name: 'x', description: 'y', parameters: { type: 'object' } } }]
    expect(requestBody({ ...REQUEST, tools })).toMatchObject({ tools, tool_choice: 'auto' })
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
      model: 'xiaomi/mimo-v2.6-flash',
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

  it('gives up after the 20 second call timeout with the did-not-answer message', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      ),
    )
    const pending = chat(REQUEST, new AbortController().signal)
    const assertion = expect(pending).rejects.toMatchObject({ status: 504, message: PROVIDER_SLOW })
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS)
    await assertion
  })

  it('stops at once when the run budget is aborted, with the did-not-answer message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      ),
    )
    const budget = new AbortController()
    const pending = chat(REQUEST, budget.signal)
    budget.abort()
    await expect(pending).rejects.toThrow(PROVIDER_SLOW)
  })

  it('refuses to call the provider when no key is configured', async () => {
    process.env.OPENROUTER_API_KEY = ''
    const fetchStub = replyOnce(200, {})
    await expect(chat(REQUEST, new AbortController().signal)).rejects.toThrow(PROVIDER_NOT_CONFIGURED)
    expect(fetchStub).not.toHaveBeenCalled()
  })
})
