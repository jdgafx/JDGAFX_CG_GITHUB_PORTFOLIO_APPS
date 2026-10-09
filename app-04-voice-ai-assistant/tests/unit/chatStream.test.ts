import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunError, type TraceStep } from '../../src/lib/api'
import { FIRST_BYTE_MS, IDLE_MS, OVERALL_MS, chat, type ChatHandlers } from '../../src/lib/chatStream'
import { encodeEvent } from '../../netlify/shared/sse'
import { jsonResponse, silentResponse, sseResponse, stubFetch } from '../helpers'

const step = (name: string, detail = ''): TraceStep => ({ name, status: 'ok', ms: 5, detail })
const ev = (event: unknown) => encodeEvent(event)

function handlers() {
  const steps: string[] = []
  const text: string[] = []
  const retries: string[] = []
  const h: ChatHandlers = {
    onStep: s => steps.push(s.name),
    onDelta: d => text.push(d),
    onRetry: r => retries.push(r),
  }
  return { h, steps, text, retries }
}

const GOOD = [
  ev({ type: 'step', step: step('request built') }),
  ': ping\n\n',
  ev({ type: 'step', step: step('tool call', 'Lisbon: 21.9 °C') }),
  ev({ type: 'delta', text: 'It is warm. ' }),
  ev({ type: 'delta', text: 'And clear.' }),
  ev({ type: 'done', result: 'It is warm. And clear.', model: 'anthropic/claude-haiku-5.5', usage: { total_tokens: 12, cost: 0.1 }, totalMs: 900 }),
  'data: [DONE]\n\n',
]

describe('chat (browser side, streaming)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('hands steps and text to the handlers in arrival order and returns the finished reply', async () => {
    const mock = stubFetch(async () => sseResponse(GOOD))
    const { h, steps, text } = handlers()
    const done = await chat('weather?', [{ role: 'user', content: 'hi' }], h)
    expect(steps).toEqual(['request built', 'tool call'])
    expect(text).toEqual(['It is warm. ', 'And clear.'])
    expect(done).toEqual({ text: 'It is warm. And clear.', model: 'anthropic/claude-haiku-5.5', usage: { total_tokens: 12, cost: 0.1, prompt_tokens: undefined, completion_tokens: undefined }, totalMs: 900 })
    expect(JSON.parse(String(mock.mock.calls[0][1]?.body))).toEqual({ message: 'weather?', history: [{ role: 'user', content: 'hi' }] })
  })

  it('reads events split across network chunks', async () => {
    const whole = GOOD.join('')
    stubFetch(async () => sseResponse([whole.slice(0, 37), whole.slice(37, 120), whole.slice(120)]))
    const { h, text } = handlers()
    await chat('q', [], h)
    expect(text.join('')).toBe('It is warm. And clear.')
  })

  it('throws the server message for an error event, after handing over what had arrived', async () => {
    stubFetch(async () =>
      sseResponse([ev({ type: 'delta', text: 'Partial. ' }), ev({ type: 'error', error: 'The AI provider did not answer in time.', totalMs: 25000 }), 'data: [DONE]\n\n']),
    )
    const { h, text } = handlers()
    const err = await chat('q', [], h).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RunError)
    expect((err as RunError).message).toBe('The AI provider did not answer in time.')
    expect((err as RunError).totalMs).toBe(25000)
    expect(text).toEqual(['Partial. '])
  })

  it('reports a stream that ends without done as stopped early', async () => {
    stubFetch(async () => sseResponse([ev({ type: 'delta', text: 'Half an ans' }), 'data: [DONE]\n\n']))
    const err = await chat('q', [], handlers().h).catch((e: unknown) => e)
    expect((err as RunError).message).toBe('The reply stopped before it was finished. What arrived is shown below.')
  })

  it('shows the server copy for a refused request and passes its trace to the handler', async () => {
    stubFetch(async () => jsonResponse({ error: 'Too many requests. Wait a moment and try again.', trace: [step('request built')] }, 429))
    const { h, steps } = handlers()
    const err = await chat('q', [], h).catch((e: unknown) => e)
    expect((err as RunError).message).toBe('Too many requests. Wait a moment and try again.')
    expect(steps).toEqual(['request built'])
  })

  it('falls back to plain copy when a refusal is not JSON (a platform 504)', async () => {
    stubFetch(async () => new Response('<html>Gateway Timeout</html>', { status: 504 }))
    const err = await chat('q', [], handlers().h).catch((e: unknown) => e)
    expect((err as RunError).message).toBe('The AI provider did not answer in time.')
  })

  it('retries once, and says why, when the connection fails before any byte', async () => {
    let calls = 0
    stubFetch(async () => {
      calls += 1
      if (calls === 1) throw new TypeError('Failed to fetch')
      return sseResponse(GOOD)
    })
    const { h, retries } = handlers()
    const done = await chat('q', [], h)
    expect(calls).toBe(2)
    expect(retries).toEqual(['the request did not reach the server'])
    expect(done.text).toBe('It is warm. And clear.')
  })

  it('retries once when the server sends nothing for the first-byte limit, then gives up with a plain message', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let calls = 0
    stubFetch(async (_url, init) => {
      calls += 1
      return silentResponse(init?.signal)
    })
    const { h, retries, steps } = handlers()
    const pending = chat('q', [], h).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(FIRST_BYTE_MS)
    expect(retries).toEqual(['the server sent nothing for 12 seconds'])
    await vi.advanceTimersByTimeAsync(FIRST_BYTE_MS)
    const err = await pending
    expect(calls).toBe(2)
    expect((err as RunError).message).toContain('The connection stopped answering')
    expect(steps).toEqual(['model call'])
  })

  it('never retries after the first byte: a stall mid-stream ends with the stalled message', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let calls = 0
    stubFetch(async (_url, init) => {
      calls += 1
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(ev({ type: 'delta', text: 'One. ' })))
            init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true })
          },
        }),
      )
    })
    const { h, text, retries } = handlers()
    const pending = chat('q', [], h).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(IDLE_MS)
    const err = await pending
    expect(calls).toBe(1)
    expect(retries).toEqual([])
    expect(text).toEqual(['One. '])
    expect((err as RunError).message).toContain('The connection stopped answering')
  })

  it('treats a server ping as a sign of life, so a slow answer is not cut at the idle limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const encoder = new TextEncoder()
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined
    stubFetch(async () => new Response(new ReadableStream<Uint8Array>({ start: c => void (controllerRef = c) })))
    const { h, text } = handlers()
    const pending = chat('q', [], h)
    await vi.advanceTimersByTimeAsync(1)
    // A ping every 20 s keeps an otherwise silent stream alive past the 30 s idle limit.
    for (let i = 0; i < 2; i++) {
      controllerRef?.enqueue(encoder.encode(': ping\n\n'))
      await vi.advanceTimersByTimeAsync(20_000)
    }
    controllerRef?.enqueue(encoder.encode(GOOD.join('')))
    controllerRef?.close()
    await expect(pending).resolves.toMatchObject({ text: 'It is warm. And clear.' })
    expect(text.join('')).toBe('It is warm. And clear.')
  })

  it('ends a reply that runs past the overall limit even if pings keep arriving', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const encoder = new TextEncoder()
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined
    stubFetch(async (_url, init) => {
      init?.signal?.addEventListener('abort', () => controllerRef?.error(new DOMException('aborted', 'AbortError')), { once: true })
      return new Response(new ReadableStream<Uint8Array>({ start: c => void (controllerRef = c) }))
    })
    const pending = chat('q', [], handlers().h).catch((e: unknown) => e)
    for (let t = 0; t < OVERALL_MS; t += 20_000) {
      controllerRef?.enqueue(encoder.encode(': ping\n\n'))
      await vi.advanceTimersByTimeAsync(20_000)
    }
    expect(((await pending) as RunError).message).toContain('The reply took too long')
  })

  it('lets the visitor’s Stop through as an abort, with no retry and no stalled message', async () => {
    let calls = 0
    stubFetch(async (_url, init) => {
      calls += 1
      return silentResponse(init?.signal)
    })
    const stop = new AbortController()
    const { h, retries } = handlers()
    const pending = chat('q', [], h, stop.signal).catch((e: unknown) => e)
    await Promise.resolve()
    stop.abort()
    const err = await pending
    expect((err as Error).name).toBe('AbortError')
    expect(calls).toBe(1)
    expect(retries).toEqual([])
  })
})
