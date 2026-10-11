import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUDGET_MESSAGE,
  chat,
  isCallTimeout,
  MODEL_CALL_TIMEOUT_MS,
  messageForStatus,
  NOT_CONFIGURED_MESSAGE,
  parseReply,
  ProviderError,
  SLOW_MESSAGE,
  UNREACHABLE_MESSAGE,
  UNREADABLE_MESSAGE,
  type ChatRequest,
} from '../../netlify/shared/openrouter'

const PLACEHOLDER_KEY = 'test-only-placeholder'
const REQUEST: ChatRequest = {
  model: 'xiaomi/mimo-v2.6-flash',
  messages: [{ role: 'user', content: 'Plan the search.' }],
  max_tokens: 400,
}

/** A fetch that never answers and rejects with the signal's reason when it aborts, as the real fetch does. */
const hangUntilAborted = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as unknown))
  })

const originalKey = process.env.OPENROUTER_API_KEY

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = PLACEHOLDER_KEY
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = originalKey
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const replyBody = (overrides: Record<string, unknown> = {}) => ({
  model: 'xiaomi/mimo-v2.6-flash',
  choices: [{ message: { role: 'assistant', content: '{"queries":["Expo 98"]}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: 0.00002 },
  ...overrides,
})

describe('parseReply', () => {
  it('reads the text, the served model, the finish reason and the reported usage and cost', () => {
    expect(parseReply(replyBody({ choices: [{ message: { content: '  Hello  ' }, finish_reason: 'stop' }] }))).toEqual({
      text: 'Hello',
      toolCalls: [],
      finishReason: 'stop',
      servedModel: 'xiaomi/mimo-v2.6-flash',
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: 0.00002 },
    })
  })

  it('reads tool calls with their id, name and raw JSON arguments', () => {
    const reply = parseReply(
      replyBody({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_9',
                  type: 'function',
                  function: { name: 'wikipedia_search', arguments: '{"query":"Expo 98"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    )
    expect(reply.text).toBe('')
    expect(reply.finishReason).toBe('tool_calls')
    expect(reply.toolCalls).toEqual([{ id: 'call_9', name: 'wikipedia_search', args: '{"query":"Expo 98"}' }])
  })

  it('drops a tool call that has no id or no name, because it cannot be answered', () => {
    const reply = parseReply(
      replyBody({
        choices: [
          {
            message: {
              tool_calls: [
                { id: 'no_name', function: { arguments: '{}' } },
                { type: 'function', function: { name: 'wikipedia_page', arguments: '{}' } },
                { id: 'ok', function: { name: 'wikipedia_page', arguments: '{"title":"Lisbon"}' } },
              ],
            },
          },
        ],
      }),
    )
    expect(reply.toolCalls).toEqual([{ id: 'ok', name: 'wikipedia_page', args: '{"title":"Lisbon"}' }])
  })

  it('turns object arguments into a JSON string', () => {
    const reply = parseReply(
      replyBody({
        choices: [
          { message: { tool_calls: [{ id: 'c', function: { name: 'wikipedia_page', arguments: { title: 'Lisbon' } } }] } },
        ],
      }),
    )
    expect(reply.toolCalls[0]?.args).toBe('{"title":"Lisbon"}')
  })

  it('leaves usage empty and the served model null when the provider sends neither', () => {
    const reply = parseReply({ choices: [{ message: { content: 'Hi' } }] })
    expect(reply.usage).toEqual({})
    expect(reply.servedModel).toBeNull()
    expect(reply.finishReason).toBeNull()
  })

  it('reads only content and tool calls when the reply also carries reasoning', () => {
    const reply = parseReply({
      model: 'anthropic/claude-haiku-5.5',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Final answer [1].',
            reasoning: 'The user wants X. I should cite [9] and call wikipedia_page with {"title":"Wrong"}.',
            reasoning_details: [{ type: 'reasoning.text', text: 'secret thinking [9]' }],
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'wikipedia_page', arguments: '{"title":"Expo 98"}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 600, total_tokens: 700, completion_tokens_details: { reasoning_tokens: 500 } },
    })
    expect(reply.text).toBe('Final answer [1].')
    expect(reply.toolCalls).toEqual([{ id: 'call_1', name: 'wikipedia_page', args: '{"title":"Expo 98"}' }])
    expect(JSON.stringify(reply)).not.toContain('secret thinking')
    expect(reply.usage.reasoning_tokens).toBe(500)
  })

  it('returns no text when the reply holds only reasoning', () => {
    const reply = parseReply({ choices: [{ message: { role: 'assistant', content: null, reasoning: 'thinking only' } }] })
    expect(reply.text).toBe('')
    expect(reply.toolCalls).toEqual([])
  })

  it('ignores usage fields that are not finite numbers', () => {
    const reply = parseReply(replyBody({ usage: { prompt_tokens: '120', completion_tokens: 30, cost: Number.NaN } }))
    expect(reply.usage).toEqual({ completion_tokens: 30 })
  })

  it('throws a plain ProviderError when the reply has no choice', () => {
    expect(() => parseReply({ model: 'x', choices: [] })).toThrow(ProviderError)
    expect(() => parseReply('not an object')).toThrow(UNREADABLE_MESSAGE)
  })
})

describe('messageForStatus', () => {
  it.each([
    [401, 'The AI provider rejected the key or is out of credit.'],
    [402, 'The AI provider rejected the key or is out of credit.'],
    [403, 'The AI provider rejected the key or is out of credit.'],
    [429, 'Rate limited, try again in a minute.'],
    [408, SLOW_MESSAGE],
    [500, SLOW_MESSAGE],
    [503, SLOW_MESSAGE],
    [418, 'The AI provider rejected the request.'],
  ])('maps HTTP %i to its plain message', (status, message) => {
    expect(messageForStatus(status)).toBe(message)
  })
})

describe('chat', () => {
  it('posts the request with no reasoning setting, usage accounting on and the placeholder key, and returns the parsed reply', async () => {
    const fetchStub = vi.fn<typeof fetch>(async () => Response.json(replyBody()))
    vi.stubGlobal('fetch', fetchStub)

    const reply = await chat(REQUEST, new AbortController().signal)

    expect(reply.text).toBe('{"queries":["Expo 98"]}')
    expect(fetchStub).toHaveBeenCalledTimes(1)
    const [url, init] = fetchStub.mock.calls[0] ?? []
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${PLACEHOLDER_KEY}` })
    // Thinking stays on: the body carries no reasoning setting at all.
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(sent).toEqual({ ...REQUEST, usage: { include: true } })
    expect('reasoning' in sent).toBe(false)
  })

  it.each([
    [401, 'The AI provider rejected the key or is out of credit.'],
    [402, 'The AI provider rejected the key or is out of credit.'],
    [429, 'Rate limited, try again in a minute.'],
    [500, SLOW_MESSAGE],
  ])('maps HTTP %i to a plain message and never shows the provider body', async (status, message) => {
    const fetchStub = vi.fn(
      async () => new Response('{"error":"internal provider detail 123"}', { status }),
    )
    vi.stubGlobal('fetch', fetchStub)

    const error: unknown = await chat(REQUEST, new AbortController().signal).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({ status, message })
    expect((error as Error).message).not.toContain('internal provider detail')
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('reports an unreachable provider in plain words', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    const error: unknown = await chat(REQUEST, new AbortController().signal).catch((err: unknown) => err)
    expect(error).toMatchObject({ status: 502, message: UNREACHABLE_MESSAGE })
  })

  it('maps an abort from the model call to the slow message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('aborted', 'AbortError')
      }),
    )
    const error: unknown = await chat(REQUEST, new AbortController().signal).catch((err: unknown) => err)
    expect(error).toMatchObject({ status: 504, message: SLOW_MESSAGE })
  })

  it('gives up after twelve seconds with the slow message, and not a moment sooner', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(hangUntilAborted))
    let settled = false
    const pending = chat(REQUEST, new AbortController().signal).catch((err: unknown) => {
      settled = true
      return err
    })

    await vi.advanceTimersByTimeAsync(MODEL_CALL_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    const error = await pending
    expect(error).toMatchObject({ status: 504, message: SLOW_MESSAGE })
    expect(isCallTimeout(error)).toBe(true)
    expect(MODEL_CALL_TIMEOUT_MS).toBe(12_000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cuts a call whose reply body never finishes at the call limit', async () => {
    vi.useFakeTimers()
    // The headers arrive at once, then the body stalls. The stream ignores the abort signal.
    const stalled = new ReadableStream<Uint8Array>({ start() {} })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stalled, { status: 200 })))
    const pending = chat(REQUEST, new AbortController().signal).catch((err: unknown) => err)

    await vi.advanceTimersByTimeAsync(MODEL_CALL_TIMEOUT_MS)

    expect(await pending).toMatchObject({ status: 504, message: SLOW_MESSAGE })
  })

  it('cuts a fetch that ignores its signal at the call limit', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)))
    const pending = chat(REQUEST, new AbortController().signal).catch((err: unknown) => err)

    await vi.advanceTimersByTimeAsync(MODEL_CALL_TIMEOUT_MS)

    expect(await pending).toMatchObject({ status: 504, message: SLOW_MESSAGE })
  })

  it('stops at once when the run budget signal aborts', async () => {
    const budget = new AbortController()
    vi.stubGlobal('fetch', vi.fn(hangUntilAborted))
    const pending = chat(REQUEST, budget.signal).catch((err: unknown) => err)
    budget.abort()
    // The run budget ending the call is not the provider being slow, so the message says so.
    const error = await pending
    expect(error).toMatchObject({ status: 504, message: BUDGET_MESSAGE })
    expect(isCallTimeout(error)).toBe(false)
  })

  it('reports a reply that is not JSON as unreadable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>')))
    const error: unknown = await chat(REQUEST, new AbortController().signal).catch((err: unknown) => err)
    expect(error).toMatchObject({ status: 502, message: UNREADABLE_MESSAGE })
  })

  it('refuses without any call when no key is configured', async () => {
    delete process.env.OPENROUTER_API_KEY
    const fetchStub = vi.fn<typeof fetch>(async () => Response.json(replyBody()))
    vi.stubGlobal('fetch', fetchStub)

    const error: unknown = await chat(REQUEST, new AbortController().signal).catch((err: unknown) => err)

    expect(error).toMatchObject({ status: 503, message: NOT_CONFIGURED_MESSAGE })
    expect(fetchStub).not.toHaveBeenCalled()
  })
})
