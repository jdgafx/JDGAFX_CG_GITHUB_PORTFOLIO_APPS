import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callModel, describeFailure, getApiKey, MODEL, ProviderError, sumUsage } from '../../netlify/shared/provider'

const KEY = 'test-only-placeholder'
const MESSAGES = [{ role: 'user' as const, content: 'hi' }]
const SIGNAL = new AbortController().signal

type FetchFn = (url: string, init: RequestInit) => Promise<Response>

let savedKey: string | undefined

beforeEach(() => {
  savedKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = KEY
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = savedKey
  vi.unstubAllGlobals()
})

function stubFetch(impl: FetchFn) {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

function reply(content: string, options: { finish?: string; usage?: Record<string, unknown> } = {}): Response {
  return new Response(
    JSON.stringify({
      model: 'anthropic/claude-haiku-test',
      choices: [{ message: { content }, finish_reason: options.finish ?? 'stop' }],
      usage: options.usage ?? { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('callModel request', () => {
  it('always sends the fixed model, an explicit token cap, and usage accounting', async () => {
    const mock = stubFetch(async () => reply('{}'))
    await callModel(MESSAGES, SIGNAL)
    const call = mock.mock.calls[0]
    const sent = JSON.parse(String(call?.[1].body)) as Record<string, unknown>
    expect(MODEL).toBe('anthropic/claude-haiku-5.5')
    expect(call?.[0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(sent).toMatchObject({
      model: 'anthropic/claude-haiku-5.5',
      max_tokens: 4096,
      reasoning: { enabled: false },
      response_format: { type: 'json_object' },
      usage: { include: true },
      messages: MESSAGES,
    })
    expect(sent).not.toHaveProperty('temperature')
    expect(call?.[1].headers).toEqual({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' })
  })

  it('refuses to call the provider when no key is set', async () => {
    process.env.OPENROUTER_API_KEY = '   '
    const mock = stubFetch(async () => reply('{}'))
    expect(getApiKey()).toBeNull()
    await expect(callModel(MESSAGES, SIGNAL)).rejects.toBeInstanceOf(ProviderError)
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('callModel usage and retries', () => {
  it('reads the token counts and cost the provider reports', async () => {
    stubFetch(async () => reply('{"a":1}'))
    const result = await callModel(MESSAGES, SIGNAL)
    expect(result).toMatchObject({ text: '{"a":1}', finish: 'stop', model: 'anthropic/claude-haiku-test', attempts: 1 })
    expect(result.usage).toEqual({ prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 })
  })

  it('drops usage fields that are not numbers', async () => {
    stubFetch(async () => reply('{}', { usage: { total_tokens: '1200', cost: 0.5 } }))
    const result = await callModel(MESSAGES, SIGNAL)
    expect(result.usage).toEqual({ cost: 0.5 })
  })

  it('asks once more after an empty reply and adds up both calls', async () => {
    const mock = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(reply('', { usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } }))
      .mockResolvedValueOnce(
        reply('{"ok":true}', { usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600, cost: 0.0001 } }),
      )
    vi.stubGlobal('fetch', mock)
    const result = await callModel(MESSAGES, SIGNAL)
    expect(mock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ text: '{"ok":true}', attempts: 2 })
    // The first reply had no cost, so the summed cost is not reported at all.
    expect(result.usage).toEqual({ prompt_tokens: 1500, completion_tokens: 300, total_tokens: 1800 })
  })

  it('does not ask again when the reply was cut off', async () => {
    const mock = stubFetch(async () => reply('{"chartType":"bar"', { finish: 'length' }))
    const result = await callModel(MESSAGES, SIGNAL)
    expect(mock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ finish: 'length', attempts: 1 })
  })
})

describe('sumUsage', () => {
  it('adds a field only when every call reported it', () => {
    expect(sumUsage([{ total_tokens: 120, cost: 0.0001 }, { total_tokens: 60 }])).toEqual({ total_tokens: 180 })
    expect(sumUsage([])).toEqual({})
  })
})

describe('describeFailure', () => {
  it.each([
    [401, 502, 'The AI provider rejected the key or is out of credit.'],
    [402, 502, 'The AI provider rejected the key or is out of credit.'],
    [429, 429, 'Rate limited, try again in a minute.'],
    [500, 502, 'The AI provider did not answer in time.'],
    [503, 502, 'The AI provider did not answer in time.'],
    [400, 502, 'The AI provider rejected the request.'],
  ])('maps provider HTTP %i to status %i', (providerStatus, status, message) => {
    expect(describeFailure(new ProviderError(providerStatus))).toEqual({ status, message })
  })

  it('maps a timeout to 504 with the did-not-answer copy', () => {
    expect(describeFailure(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toEqual({
      status: 504,
      message: 'The AI provider did not answer in time.',
    })
  })

  it('maps a network failure to a generic provider message', () => {
    expect(describeFailure(new TypeError('fetch failed'))).toEqual({
      status: 502,
      message: 'Could not reach the AI provider. Try again.',
    })
  })
})
