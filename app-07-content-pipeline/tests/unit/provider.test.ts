import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODEL, ProviderStatusError, chat } from '../../netlify/shared/provider'

const PLACEHOLDER = 'test-only-placeholder'
let savedKey: string | undefined

beforeEach(() => {
  savedKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = PLACEHOLDER
  // Any call that is not stubbed fails the test rather than reaching a real provider.
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('The provider was called without a test stub')
  }))
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = savedKey
  vi.unstubAllGlobals()
})

const USAGE = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 }

function completion(overrides: Record<string, unknown> = {}): Response {
  const payload = {
    model: 'anthropic/claude-haiku-5.5',
    choices: [{ message: { content: 'Article text.' }, finish_reason: 'stop' }],
    usage: USAGE,
    ...overrides,
  }
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
}

interface FetchCall {
  url: string
  init: RequestInit | undefined
}

// Answers each request with `reply`, and returns the list that records every request made.
function fetchReturns(reply: () => Response): FetchCall[] {
  const calls: FetchCall[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return reply()
  }))
  return calls
}

describe('chat request', () => {
  it('sends the fixed model, the token ceiling, usage reporting and the key, and no streaming', async () => {
    const calls = fetchReturns(() => completion())
    const controller = new AbortController()

    await chat('SYSTEM', 'USER', 160, controller.signal)

    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(call.init?.signal).toBe(controller.signal)
    expect(call.init?.headers).toMatchObject({ Authorization: `Bearer ${PLACEHOLDER}` })
    const body = JSON.parse(String(call.init?.body)) as Record<string, unknown>
    expect(MODEL).toBe('anthropic/claude-haiku-5.5')
    expect(body.model).toBe('anthropic/claude-haiku-5.5')
    expect(body).not.toHaveProperty('temperature')
    expect(body.max_tokens).toBe(160)
    expect(body.usage).toEqual({ include: true })
    expect(body.stream).toBe(false)
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'USER' },
    ])
  })
})

describe('chat reply', () => {
  it('reads the text, the finish reason, the served model and the usage', async () => {
    fetchReturns(() => completion())
    const reply = await chat('S', 'U', 160, new AbortController().signal)
    expect(reply).toEqual({
      content: 'Article text.',
      finishReason: 'stop',
      servedModel: 'anthropic/claude-haiku-5.5',
      usage: USAGE,
    })
  })

  it('reports no cost when the provider sends none, rather than inventing one', async () => {
    fetchReturns(() => completion({ usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } }))
    const reply = await chat('S', 'U', 160, new AbortController().signal)
    expect(reply.usage).toEqual({ prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 })
    expect(reply.usage?.cost).toBeUndefined()
  })

  it('drops a usage block whose token count is not a number', async () => {
    fetchReturns(() => completion({ usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: '1200', cost: 0.0002 } }))
    const reply = await chat('S', 'U', 160, new AbortController().signal)
    expect(reply.usage).toBeNull()
  })

  it('ignores a cost that is not a number', async () => {
    fetchReturns(() => completion({ usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 'free' } }))
    const reply = await chat('S', 'U', 160, new AbortController().signal)
    expect(reply.usage?.cost).toBeUndefined()
    expect(reply.usage?.total_tokens).toBe(1200)
  })
})

describe('chat errors', () => {
  it('throws a status-only error that never carries the provider body', async () => {
    fetchReturns(() => new Response('{"error":"account acct_secret_123 has no credit"}', { status: 402 }))
    const error: unknown = await chat('S', 'U', 160, new AbortController().signal).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(ProviderStatusError)
    expect((error as ProviderStatusError).status).toBe(402)
    expect((error as Error).message).toBe('AI provider responded with HTTP 402')
    expect((error as Error).message).not.toContain('acct_secret_123')
  })
})
