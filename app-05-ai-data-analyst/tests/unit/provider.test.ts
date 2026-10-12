import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { billedUsage, callModel, describeFailure, getApiKey, MODEL, ProviderError, sumUsage } from '../../netlify/shared/provider'

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
    expect(MODEL).toBe('~anthropic/claude-haiku-latest')
    expect(call?.[0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(sent).toMatchObject({
      model: '~anthropic/claude-haiku-latest',
      max_tokens: 6144,
      response_format: { type: 'json_object' },
      usage: { include: true },
      messages: MESSAGES,
    })
    expect(sent).not.toHaveProperty('temperature')
    expect(call?.[1].headers).toEqual({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' })
  })

  it('leaves thinking to the model default: no request body carries reasoning.enabled false', async () => {
    const mock = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(reply(''))
      .mockResolvedValueOnce(reply('{}'))
    vi.stubGlobal('fetch', mock)
    await callModel(MESSAGES, SIGNAL)
    expect(mock).toHaveBeenCalledTimes(2)
    for (const call of mock.mock.calls) {
      const sent = JSON.parse(String(call[1].body)) as { reasoning?: { enabled?: unknown } }
      expect(sent.reasoning?.enabled).not.toBe(false)
      expect(sent).not.toHaveProperty('reasoning')
    }
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

  it('reports the model of the try that produced the reply, not an empty first try', async () => {
    const unnamed = new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const mock = vi.fn<FetchFn>().mockResolvedValueOnce(reply('')).mockResolvedValueOnce(unnamed)
    vi.stubGlobal('fetch', mock)
    const result = await callModel(MESSAGES, SIGNAL)
    expect(result).toMatchObject({ text: '{"ok":true}', attempts: 2, model: null })
    expect(result.servedModels).toEqual(['anthropic/claude-haiku-test', null])
  })

  it('parses only message.content when the reply also carries reasoning fields', async () => {
    const decoy = '{"chartType":"pie","title":"from the reasoning"}'
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            model: 'anthropic/claude-haiku-test',
            choices: [
              {
                message: {
                  content: '{"answer":"content"}',
                  reasoning: decoy,
                  reasoning_details: [{ type: 'reasoning.text', text: decoy }],
                },
                finish_reason: 'stop',
              },
            ],
            usage: { total_tokens: 900, completion_tokens_details: { reasoning_tokens: 400 } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    const result = await callModel(MESSAGES, SIGNAL)
    expect(result.text).toBe('{"answer":"content"}')
    expect(JSON.stringify(result)).not.toContain('from the reasoning')
  })

  it('returns an empty cut-off reply as such, without a second try, so the caller can report it', async () => {
    const mock = stubFetch(async () => reply('', { finish: 'length' }))
    const result = await callModel(MESSAGES, SIGNAL)
    expect(mock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ text: '', finish: 'length', attempts: 1 })
  })

  it('does not ask again when the reply was cut off', async () => {
    const mock = stubFetch(async () => reply('{"chartType":"bar"', { finish: 'length' }))
    const result = await callModel(MESSAGES, SIGNAL)
    expect(mock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ finish: 'length', attempts: 1 })
  })
})

describe('callModel retry after a timeout or a lost connection', () => {
  const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

  it('repeats a timed-out try once and reports why', async () => {
    const mock = vi.fn<FetchFn>().mockRejectedValueOnce(aborted()).mockResolvedValueOnce(reply('{"ok":true}'))
    vi.stubGlobal('fetch', mock)
    const result = await callModel(MESSAGES, SIGNAL)
    expect(mock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ text: '{"ok":true}', attempts: 1, retriedAfter: 'timeout' })
  })

  it('repeats a lost connection once and reports why', async () => {
    const mock = vi.fn<FetchFn>().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(reply('{}'))
    vi.stubGlobal('fetch', mock)
    expect((await callModel(MESSAGES, SIGNAL)).retriedAfter).toBe('connection')
  })

  it('gives up after the one retry', async () => {
    const mock = vi.fn<FetchFn>().mockRejectedValue(aborted())
    vi.stubGlobal('fetch', mock)
    await expect(callModel(MESSAGES, SIGNAL)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('does not retry an HTTP error, a stop by the caller, or a run with under 10 seconds left', async () => {
    const http = vi.fn<FetchFn>().mockResolvedValue(new Response('{}', { status: 500 }))
    vi.stubGlobal('fetch', http)
    await expect(callModel(MESSAGES, SIGNAL)).rejects.toBeInstanceOf(ProviderError)
    expect(http).toHaveBeenCalledTimes(1)

    const stopped = new AbortController()
    stopped.abort()
    const none = vi.fn<FetchFn>().mockRejectedValue(aborted())
    vi.stubGlobal('fetch', none)
    await expect(callModel(MESSAGES, stopped.signal)).rejects.toBeDefined()
    expect(none.mock.calls.length).toBeLessThanOrEqual(1)

    const late = vi.fn<FetchFn>().mockRejectedValue(aborted())
    vi.stubGlobal('fetch', late)
    await expect(callModel(MESSAGES, SIGNAL, { deadlineAt: Date.now() + 5_000 })).rejects.toBeDefined()
    expect(late).toHaveBeenCalledTimes(1)
  })
})

describe('sumUsage', () => {
  it('adds a field only when every call reported it', () => {
    expect(sumUsage([{ total_tokens: 120, cost: 0.0001 }, { total_tokens: 60 }])).toEqual({ total_tokens: 180 })
    expect(sumUsage([])).toEqual({})
  })

  it('counts calls that reported nothing instead of dropping the figures of the others', () => {
    expect(sumUsage([{ total_tokens: 120, cost: 0.0001 }], 1)).toEqual({ total_tokens: 120, cost: 0.0001, unreportedCalls: 1 })
    expect(sumUsage([{ total_tokens: 120, cost: 0.0001, unreportedCalls: 1 }, { unreportedCalls: 2 }], 1)).toEqual({
      total_tokens: 120,
      cost: 0.0001,
      unreportedCalls: 4,
    })
    expect(sumUsage([], 1)).toEqual({ unreportedCalls: 1 })
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

// C13: a try that never reported usage is counted as not reported, and a try that did report it keeps its
// usage even when a later try of the same call fails. The failure carries both.
describe('callModel billed usage on failure', () => {
  const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' })
  const caught = async (): Promise<unknown> => callModel(MESSAGES, SIGNAL).then(() => undefined, (err: unknown) => err)

  it('carries the usage of an empty first reply when the second try is an HTTP error', async () => {
    const mock = vi.fn<FetchFn>().mockResolvedValueOnce(reply('')).mockResolvedValueOnce(new Response('{}', { status: 500 }))
    vi.stubGlobal('fetch', mock)
    const err = await caught()
    expect(err).toBeInstanceOf(ProviderError)
    expect(billedUsage(err)).toEqual({ prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002, unreportedCalls: 1 })
  })

  it('carries the usage of an empty first reply when the second try times out', async () => {
    const mock = vi.fn<FetchFn>().mockResolvedValueOnce(reply('')).mockRejectedValueOnce(aborted()).mockRejectedValueOnce(aborted())
    vi.stubGlobal('fetch', mock)
    const err = await caught()
    expect(err).toMatchObject({ name: 'AbortError' })
    expect(billedUsage(err)).toMatchObject({ total_tokens: 1200, cost: 0.0002, unreportedCalls: 2 })
  })

  it('counts every timed-out try as not reported, with no figures', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchFn>().mockRejectedValue(aborted()))
    expect(billedUsage(await caught())).toEqual({ unreportedCalls: 2 })
  })

  it('counts a 5xx as one call not reported', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchFn>().mockResolvedValue(new Response('{}', { status: 500 })))
    expect(billedUsage(await caught())).toEqual({ unreportedCalls: 1 })
  })

  it.each([400, 401, 402, 403, 429])('counts an HTTP %i as $0, not as not reported', async (status) => {
    vi.stubGlobal('fetch', vi.fn<FetchFn>().mockResolvedValue(new Response('{}', { status })))
    expect(billedUsage(await caught())).toEqual({})
  })

  it('shows a reply that needed a retry after a timeout as partial', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchFn>().mockRejectedValueOnce(aborted()).mockResolvedValueOnce(reply('{"ok":true}')))
    const result = await callModel(MESSAGES, SIGNAL)
    expect(result.usage).toEqual({ prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002, unreportedCalls: 1 })
  })

  it('has nothing to report when no call was made', async () => {
    process.env.OPENROUTER_API_KEY = '   '
    expect(billedUsage(await caught())).toBeUndefined()
  })
})
