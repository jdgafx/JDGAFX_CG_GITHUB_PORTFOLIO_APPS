import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Provider } from '../../netlify/shared/provider'
import { AGENTS, type AgentConfig } from '../../netlify/shared/agents'
import {
  RunCancelledError,
  friendlyUpstreamMessage,
  parseFrame,
  runStage,
  UpstreamError,
  type StageResult,
} from '../../netlify/shared/stream'

const provider: Provider = { url: 'https://openrouter.example/chat', apiKey: 'test-only-placeholder' }
const SERVED = 'anthropic/claude-haiku-5.5'
const encoder = new TextEncoder()
/** A run that is never cancelled in these tests. */
const LIVE = new AbortController().signal

function stageAt(index: number): AgentConfig {
  const agent = AGENTS[index]
  if (!agent) throw new Error(`no stage at ${index}`)
  return agent
}

function emptyResult(): StageResult {
  return { content: '', finish: null, reasoningTokens: 0, usage: {} }
}

function frame(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`
}

const SSE = { status: 200, headers: { 'content-type': 'text/event-stream' } }

/** One upstream reply: a text frame, a finish frame with usage, and the end marker. */
function upstreamReply(
  text: string,
  options: { finish?: string; prompt?: number; completion?: number; cost?: number } = {},
): Response {
  const { finish = 'stop', prompt = 10, completion = 4, cost = 0.00002 } = options
  const body =
    frame({ model: SERVED, choices: [{ delta: { content: text } }] }) +
    frame({
      model: SERVED,
      choices: [{ delta: {}, finish_reason: finish }],
      usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, cost },
    }) +
    'data: [DONE]\n\n'
  return new Response(body, SSE)
}

/** A reply that streams its text and then ends without a finish reason. */
function unfinishedReply(text: string): () => Response {
  return () => new Response(frame({ model: SERVED, choices: [{ delta: { content: text } }] }) + 'data: [DONE]\n\n', SSE)
}

/** A reply whose stream carries an error object after some text. */
function errorReply(text: string): () => Response {
  return () =>
    new Response(
      frame({ model: SERVED, choices: [{ delta: { content: text } }] }) +
        frame({ error: { code: 500, message: 'upstream closed' } }) +
        'data: [DONE]\n\n',
      SSE,
    )
}

/** A reply whose body yields its parts one read at a time, then fails the way a dropped connection does. */
function droppedBody(parts: string[]): () => Response {
  return () => {
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const part = parts[sent]
        sent += 1
        if (part === undefined) controller.error(new TypeError('socket reset'))
        else controller.enqueue(encoder.encode(part))
      },
    })
    return new Response(body, SSE)
  }
}

/** A reply body that sends nothing until its call is aborted, as a stalled connection would. */
function stalledBody(init: RequestInit | undefined): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
    },
  })
}

/** Stubs fetch with one planned response per call. Each response is built fresh, so a body is read once. */
function stubFetch(...replies: Array<() => Response>) {
  let call = 0
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const reply = replies[Math.min(call, replies.length - 1)]
    call += 1
    if (!reply) throw new Error('no reply planned')
    return reply()
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('parseFrame', () => {
  it('appends text and records the served model and the finish reason', () => {
    const result = emptyResult()
    parseFrame(`data: {"model":"${SERVED}","choices":[{"delta":{"content":"Hel"}}]}`, result)
    parseFrame(`data: {"model":"${SERVED}","choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}`, result)
    expect(result.content).toBe('Hello')
    expect(result.finish).toBe('stop')
    expect(result.servedModel).toBe(SERVED)
  })

  it('reads usage, cost and reasoning tokens from the usage frame', () => {
    const result = emptyResult()
    parseFrame(
      'data: {"model":"m","choices":[],"usage":{"prompt_tokens":120,"completion_tokens":40,"total_tokens":160,"cost":0.00012,"completion_tokens_details":{"reasoning_tokens":5}}}',
      result,
    )
    expect(result.usage).toEqual({ prompt_tokens: 120, completion_tokens: 40, total_tokens: 160, cost: 0.00012 })
    expect(result.reasoningTokens).toBe(5)
  })

  it('leaves cost unset when the provider sends a non-number, so it shows as not reported', () => {
    const result = emptyResult()
    parseFrame('data: {"choices":[],"usage":{"prompt_tokens":3,"cost":"free"}}', result)
    expect(result.usage.cost).toBeUndefined()
    expect(result.usage.prompt_tokens).toBe(3)
  })

  it('ignores keep-alive comments, the end marker and broken JSON', () => {
    const result = emptyResult()
    for (const line of [': OPENROUTER PROCESSING', 'data: [DONE]', 'data: {"choices":[{"delta":{"content":"x"', 'event: ping', '']) {
      parseFrame(line, result)
    }
    expect(result).toEqual(emptyResult())
  })

  it('records an error object in the stream as an error finish, and keeps none of its text', () => {
    const result = emptyResult()
    parseFrame(`data: {"model":"${SERVED}","choices":[{"delta":{"content":"Half"}}]}`, result)
    parseFrame('data: {"error":{"code":500,"message":"upstream closed"}}', result)
    expect(result.finish).toBe('error')
    expect(result.content).toBe('Half')
    expect(JSON.stringify(result)).not.toContain('upstream closed')
  })
})

describe('friendlyUpstreamMessage', () => {
  it('maps provider statuses to plain words and never echoes the body', () => {
    expect(friendlyUpstreamMessage(402)).toBe('The AI provider rejected the key or is out of credit.')
    expect(friendlyUpstreamMessage(401)).toBe('The AI provider rejected the key or is out of credit.')
    expect(friendlyUpstreamMessage(429)).toBe('Rate limited, try again in a minute.')
    expect(friendlyUpstreamMessage(500)).toBe('The AI provider did not answer in time.')
    expect(friendlyUpstreamMessage(408)).toBe('The AI provider did not answer in time.')
    expect(friendlyUpstreamMessage(418)).toBe('The AI provider could not complete this request.')
  })
})

describe('runStage', () => {
  it('assembles text, model and usage from a reply that arrives in pieces', async () => {
    const pieces =
      frame({ model: SERVED, choices: [{ delta: { content: 'Hello' } }] }) +
      frame({
        model: SERVED,
        choices: [{ delta: { content: '!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, cost: 0.00002 },
      }) +
      'data: [DONE]\n\n'
    const cut = pieces.indexOf('"content":"!"') + 3
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(pieces.slice(0, cut)))
        controller.enqueue(encoder.encode(pieces.slice(cut)))
        controller.close()
      },
    })
    const fetchMock = stubFetch(() => new Response(body, SSE))

    const result = await runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, LIVE)

    expect(result).toEqual({
      content: 'Hello!',
      finish: 'stop',
      servedModel: SERVED,
      reasoningTokens: 0,
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, cost: 0.00002 },
    })
    const init = fetchMock.mock.calls[0]?.[1]
    const sent = JSON.parse(String(init?.body)) as { model: string; max_tokens: number; usage: { include: boolean } }
    expect(sent).toMatchObject({ model: 'anthropic/claude-haiku-5.5', max_tokens: 600, usage: { include: true } })
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-only-placeholder' })
  })

  it('retries once after a 503 and uses the second reply', async () => {
    const fetchMock = stubFetch(() => new Response('busy', { status: 503 }), () => upstreamReply('Recovered'))

    const result = await runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, LIVE)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.content).toBe('Recovered')
  })

  it('does not retry a rejected key or missing credit', async () => {
    const fetchMock = stubFetch(() => new Response('{"error":"insufficient"}', { status: 402 }))

    await expect(runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, LIVE)).rejects.toMatchObject({
      name: 'UpstreamError',
      status: 402,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a cut-off reply, keeps the fuller text, and bills both attempts', async () => {
    const fetchMock = stubFetch(
      () => upstreamReply('Half', { finish: 'length' }),
      () => upstreamReply('Full answer'),
    )

    const result = await runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, LIVE)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.content).toBe('Full answer')
    expect(result.finish).toBe('stop')
    expect(result.usage).toMatchObject({ prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 })
    expect(result.usage.cost).toBeCloseTo(0.00004, 10)
  })

  it('rethrows the provider 503 when no second attempt fits, instead of reporting a timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const fetchMock = stubFetch(() => new Response('busy', { status: 503 }), () => upstreamReply('Too late'))

    const run = runStage(stageAt(0), 'Q', provider, Date.now() + 2_500, LIVE)
    const failure = expect(run).rejects.toMatchObject({ name: 'UpstreamError', status: 503 })
    await vi.advanceTimersByTimeAsync(1_000)
    await failure

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rethrows the provider 429 when no second attempt fits, so the user sees the rate limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const fetchMock = stubFetch(() => new Response('slow down', { status: 429 }), () => upstreamReply('Too late'))

    const run = runStage(stageAt(0), 'Q', provider, Date.now() + 2_500, LIVE)
    const failure = expect(run).rejects.toMatchObject({ name: 'UpstreamError', status: 429 })
    await vi.advanceTimersByTimeAsync(1_000)
    await failure

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caps the attempt at what is left of the shared deadline, not the stage own cap', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const started = Date.now()
    let abortedAt: number | undefined
    const fetchMock = vi.fn<typeof fetch>(
      (...args) =>
        new Promise<Response>((_resolve, reject) => {
          args[1]?.signal?.addEventListener('abort', () => {
            abortedAt = Date.now()
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    // The researcher's own cap is 5,500 ms; the run has only 3,000 ms left.
    const run = runStage(stageAt(0), 'Q', provider, started + 3_000, LIVE)
    await vi.advanceTimersByTimeAsync(3_000)
    const result = await run

    expect(abortedAt).toBe(started + 3_000)
    expect(result).toMatchObject({ content: '', finish: 'timeout' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps a provider timeout to a timeout result after one retry', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, LIVE)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ content: '', finish: 'timeout', retried: 'timeout' })
  })

  it('retries a call that hung before any answer, and says so on the result', async () => {
    const fetchMock = stubFetch(
      () => {
        throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
      },
      () => upstreamReply('Second try worked.'),
    )

    const result = await runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, LIVE)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ content: 'Second try worked.', finish: 'stop', retried: 'timeout' })
  })

  it('retries a dropped connection once', async () => {
    const fetchMock = stubFetch(
      () => {
        throw new TypeError('fetch failed')
      },
      () => upstreamReply('Back again.'),
    )

    const result = await runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, LIVE)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ content: 'Back again.', retried: 'connection' })
  })

  it('does not retry a rejected request (4xx)', async () => {
    const fetchMock = stubFetch(() => new Response('no', { status: 400 }), () => upstreamReply('never reached'))

    await expect(runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, LIVE)).rejects.toBeInstanceOf(UpstreamError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a timeout when less than the minimum retry time is left', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runStage(stageAt(0), 'Q', provider, Date.now() + 1_500, LIVE)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ content: '', finish: 'timeout' })
  })

  it('retries a 500 once and then reports the upstream error', async () => {
    const fetchMock = stubFetch(() => new Response('oops', { status: 500 }), () => new Response('oops', { status: 500 }))

    await expect(runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, LIVE)).rejects.toBeInstanceOf(UpstreamError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('keeps the text of a retry that the body dropped partway through, and labels it interrupted', async () => {
    const fetchMock = stubFetch(
      () => upstreamReply('Start', { finish: 'length' }),
      droppedBody([frame({ model: SERVED, choices: [{ delta: { content: 'Second part' } }] })]),
    )

    const result = await runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, LIVE)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ content: 'Second part', finish: 'interrupted' })
    // The cut-off attempt sent no usage, so the stage total is not reported, as usage.ts requires.
    expect(result.usage).toEqual({})
  })

  it('keeps the first attempt text when the retry drops before any text arrives', async () => {
    const fetchMock = stubFetch(() => upstreamReply('Start', { finish: 'length' }), droppedBody([]))

    const result = await runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, LIVE)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ content: 'Start', finish: 'length' })
  })

  it('retries a reply that ends without a finish reason, and keeps the fuller answer', async () => {
    const fetchMock = stubFetch(unfinishedReply('Half'), () => upstreamReply('Full answer'))

    const result = await runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, LIVE)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ content: 'Full answer', finish: 'stop' })
  })

  it('keeps a reply that ends without a finish reason when no second attempt fits, labelled interrupted', async () => {
    const fetchMock = stubFetch(unfinishedReply('Half'), () => upstreamReply('Too late'))

    const result = await runStage(stageAt(0), 'Q', provider, Date.now() + 1_500, LIVE)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ content: 'Half', finish: 'interrupted' })
  })

  it('retries a reply that carries an error object in its stream', async () => {
    const fetchMock = stubFetch(errorReply('Half'), () => upstreamReply('Full answer'))

    const result = await runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, LIVE)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ content: 'Full answer', finish: 'stop' })
  })

  it('keeps an in-stream error reply when no second attempt fits, and never stores the error text', async () => {
    const fetchMock = stubFetch(errorReply('Half'), () => upstreamReply('Too late'))

    const result = await runStage(stageAt(0), 'Q', provider, Date.now() + 1_500, LIVE)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ content: 'Half', finish: 'error' })
    expect(JSON.stringify(result)).not.toContain('upstream closed')
  })

  it('starts no call when the run was cancelled before the stage began', async () => {
    const fetchMock = stubFetch(() => upstreamReply('Never sent'))
    const cancelled = new AbortController()
    cancelled.abort()

    await expect(runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, cancelled.signal)).rejects.toBeInstanceOf(
      RunCancelledError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts the call in flight when the run is cancelled, and throws RunCancelledError', async () => {
    const run = new AbortController()
    let callStarted: (() => void) | undefined
    const firstCall = new Promise<void>(resolve => {
      callStarted = resolve
    })
    const fetchMock = vi.fn<typeof fetch>(async (...args) => {
      callStarted?.()
      return new Response(stalledBody(args[1]), SSE)
    })
    vi.stubGlobal('fetch', fetchMock)

    const outcome = runStage(stageAt(0), 'Q', provider, Date.now() + 60_000, run.signal)
    await firstCall
    run.abort()

    await expect(outcome).rejects.toBeInstanceOf(RunCancelledError)
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })
})
