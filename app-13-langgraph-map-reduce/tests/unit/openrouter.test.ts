import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderError, RunBudgetError } from '../../netlify/shared/errors'
import { CHECK, EXTRACT, MODEL, SYNTH } from '../../netlify/shared/models'
import { CALL_TIMEOUT_MS, chat, kindForStatus, parseReply, type ChatRequest } from '../../netlify/shared/openrouter'

const KEY = 'test-only-placeholder'
const request: ChatRequest = {
  model: MODEL,
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 400,
  jsonMode: true,
}
const noAbort = (): AbortSignal => new AbortController().signal

let previousKey: string | undefined

beforeEach(() => {
  previousKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = KEY
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = previousKey
})

const okBody = {
  model: 'anthropic/claude-haiku-5.5-served',
  choices: [{ message: { content: ' {"points": ["A rule."]} ' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.00004 },
}

/** A fetch that never answers and rejects when the call is aborted, like a hung provider. */
function hangingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
  )
}

/** The JSON body the first fetch call sent. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

describe('parseReply', () => {
  it('reads trimmed text, the served model, the finish reason, usage and the reported cost', () => {
    const reply = parseReply(okBody)

    expect(reply).toEqual({
      text: '{"points": ["A rule."]}',
      finishReason: 'stop',
      servedModel: 'anthropic/claude-haiku-5.5-served',
      usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
      cost: 0.00004,
    })
  })

  it('reports no usage and no cost when the reply carries none', () => {
    const reply = parseReply({ choices: [{ message: { content: 'x' } }] })

    expect(reply.usage).toBeNull()
    expect(reply.cost).toBeNull()
    expect(reply.servedModel).toBeNull()
  })

  it('reads an unreadable payload as an empty reply, which callers treat as a miss', () => {
    expect(parseReply('nonsense')).toEqual({ text: '', finishReason: null, servedModel: null, usage: null, cost: null })
    expect(parseReply({ choices: [{ message: { content: null }, finish_reason: 'length' }] }).text).toBe('')
  })
})

describe('kindForStatus', () => {
  it.each([
    [401, 'rejected'],
    [402, 'rejected'],
    [403, 'rejected'],
    [429, 'rate_limited'],
    [400, 'bad_request'],
    [404, 'bad_request'],
    [408, 'timeout'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('maps HTTP %i to %s', (status, kind) => {
    expect(kindForStatus(status)).toBe(kind)
  })
})

describe('chat', () => {
  it('sends the required body fields and the JSON-mode option, and no temperature, reasoning or provider option', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const reply = await chat(request, noAbort())

    expect(reply.text).toBe('{"points": ["A rule."]}')
    expect(reply.cost).toBe(0.00004)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    const body = sentBody(fetchMock)
    expect(body).toMatchObject({
      model: 'anthropic/claude-haiku-5.5',
      max_tokens: 400,
      usage: { include: true },
      response_format: { type: 'json_object' },
    })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('reasoning')
    expect(body).not.toHaveProperty('provider')
  })

  it('sends no JSON-mode, reasoning or provider option when the role asks for none', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await chat({ ...request, jsonMode: false }, noAbort())

    const body = sentBody(fetchMock)
    expect(body).not.toHaveProperty('response_format')
    expect(body).not.toHaveProperty('reasoning')
    expect(body).not.toHaveProperty('provider')
  })

  it('sends require_parameters for the synthesis call', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await chat({ ...request, requireParameters: true }, noAbort())

    expect(sentBody(fetchMock)).toMatchObject({
      provider: { require_parameters: true },
      response_format: { type: 'json_object' },
    })
  })

  it('sends the check call with JSON mode and reasoning off, and no temperature or provider option', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await chat({ ...CHECK, messages: [{ role: 'user', content: 'review' }] }, noAbort())

    const body = sentBody(fetchMock)
    expect(body).toMatchObject({ model: MODEL, max_tokens: 300, reasoning: { enabled: false }, response_format: { type: 'json_object' } })
    for (const key of ['temperature', 'provider']) expect(body).not.toHaveProperty(key)
  })

  it('sends the extract call with reasoning off and no temperature, JSON-mode or provider option', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await chat({ ...EXTRACT, messages: [{ role: 'user', content: 'chunk' }] }, noAbort())

    const body = sentBody(fetchMock)
    expect(body).toMatchObject({ model: MODEL, max_tokens: 800, reasoning: { enabled: false } })
    for (const key of ['temperature', 'provider', 'response_format']) expect(body).not.toHaveProperty(key)
  })

  it('sends the synthesis request with reasoning off and require_parameters, and no temperature', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await chat({ ...SYNTH, messages: [{ role: 'user', content: 'write' }] }, noAbort())

    const body = sentBody(fetchMock)
    expect(body).toMatchObject({
      model: MODEL,
      reasoning: { enabled: false },
      provider: { require_parameters: true },
      response_format: { type: 'json_object' },
    })
    expect(body).not.toHaveProperty('temperature')
  })

  it('sends the reasoning option a role asks for', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await chat({ ...request, reasoning: { effort: 'low', exclude: true } }, noAbort())

    expect(sentBody(fetchMock)).toMatchObject({ reasoning: { effort: 'low', exclude: true } })
  })

  it('maps a 402 to a fatal rejection with the plain message and never shows the provider body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"insufficient credits, acct 9981"}', { status: 402 })))

    const error = await chat(request, noAbort()).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).fatal).toBe(true)
    expect((error as Error).message).toBe('The AI provider rejected the key or is out of credit.')
    expect((error as Error).message).not.toContain('9981')
  })

  it('maps a 500 to a non-fatal server error with the timeout message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('internal detail', { status: 500 })))

    const error = (await chat(request, noAbort()).catch((e: unknown) => e)) as ProviderError

    expect(error.kind).toBe('unavailable')
    expect(error.fatal).toBe(false)
    expect(error.message).toBe('The AI provider did not answer in time.')
  })

  it('treats a refused request (404) as a chunk-level failure, not a fatal one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no endpoint for these parameters', { status: 404 })))

    const error = (await chat(request, noAbort()).catch((e: unknown) => e)) as ProviderError

    expect(error.kind).toBe('bad_request')
    expect(error.fatal).toBe(false)
    expect(error.message).toBe('The AI provider rejected the request.')
  })

  it('treats a rate limit (429) as a chunk-level failure, not a fatal one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', { status: 429 })))

    const error = (await chat(request, noAbort()).catch((e: unknown) => e)) as ProviderError

    expect(error.kind).toBe('rate_limited')
    expect(error.fatal).toBe(false)
    expect(error.message).toBe('Rate limited, try again in a minute.')
  })

  it('maps a network failure to a non-fatal network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))

    const error = (await chat(request, noAbort()).catch((e: unknown) => e)) as ProviderError

    expect(error.kind).toBe('network')
    expect(error.message).toBe('Could not reach the AI provider.')
  })

  it('gives up after 10 seconds with a non-fatal timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())

    const pending = chat(request, noAbort()).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS - 1)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    const error = (await pending) as ProviderError

    expect(CALL_TIMEOUT_MS).toBe(10_000)
    expect(error.kind).toBe('timeout')
    expect(error.fatal).toBe(false)
  })

  it('lets a request carry its own, shorter timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())

    const pending = chat({ ...request, timeoutMs: 5_000 }, noAbort()).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_000)
    const error = (await pending) as ProviderError

    expect(error.kind).toBe('timeout')
  })

  it('cuts a response whose body never finishes at the limit, even when the fetch ignores its abort signal', async () => {
    vi.useFakeTimers()
    const stalled = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stalled, { status: 200 })))

    let settled: unknown = 'pending'
    const pending = chat({ ...request, timeoutMs: 5_000 }, noAbort()).catch((e: unknown) => {
      settled = e
    })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(settled).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    await pending

    expect((settled as ProviderError).kind).toBe('timeout')
  })

  it('cuts a fetch that never settles and never listens to its signal at the 10 s default', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)))

    let settled: unknown = 'pending'
    const pending = chat(request, noAbort()).catch((e: unknown) => {
      settled = e
    })
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS - 1)
    expect(settled).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    await pending

    expect((settled as ProviderError).kind).toBe('timeout')
  })

  it('drops a reply that arrives after the limit, without an unhandled rejection', async () => {
    vi.useFakeTimers()
    let answer: (r: Response) => void = () => undefined
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))))
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    const pending = chat({ ...request, timeoutMs: 1_000 }, noAbort()).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(((await pending) as ProviderError).kind).toBe('timeout')
    answer(new Response(JSON.stringify(okBody), { status: 200 }))
    await vi.advanceTimersByTimeAsync(10)

    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('cuts a fetch that ignores its signal when the run signal aborts', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)))

    const pending = chat(request, controller.signal).catch((e: unknown) => e)
    controller.abort(new RunBudgetError())

    expect(await pending).toBeInstanceOf(RunBudgetError)
  })

  it('times out for real after the request timeout, with no mocked clock', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const started = Date.now()

    const error = (await chat({ ...request, timeoutMs: 40 }, noAbort()).catch((e: unknown) => e)) as ProviderError

    expect(error.kind).toBe('timeout')
    expect(Date.now() - started).toBeGreaterThanOrEqual(35)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('never sends the request timeout to the provider', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await chat({ ...request, timeoutMs: 5_000 }, noAbort())

    expect(JSON.stringify(sentBody(fetchMock))).not.toContain('timeout')
  })

  it('reports a run-budget abort as a RunBudgetError, not as a provider timeout', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', hangingFetch())

    const pending = chat(request, controller.signal).catch((e: unknown) => e)
    controller.abort(new RunBudgetError())

    expect(await pending).toBeInstanceOf(RunBudgetError)
  })

  it('reports a halt by another call as a RunBudgetError, not as the halting provider error', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', hangingFetch())

    const pending = chat(request, controller.signal).catch((e: unknown) => e)
    controller.abort(new ProviderError('rejected'))

    expect(await pending).toBeInstanceOf(RunBudgetError)
  })

  it('refuses to call the provider when no key is configured', async () => {
    delete process.env.OPENROUTER_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const error = await chat(request, noAbort()).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
