import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDLE_TIMEOUT_MS, OVERALL_TIMEOUT_MS, runAnalysis, STALLED } from '../../src/lib/api'
import type { Frame } from '../../src/types/frames'

const UNREACHABLE = 'Could not reach the server. Check your connection and try again.'
const encoder = new TextEncoder()

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** A body that delivers one event, then fails the read the way a dropped connection does. */
function brokenBody(): ReadableStream<Uint8Array> {
  let sent = false
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(encoder.encode('data: {"type":"node_start","node":"split","ms":1,"detail":"Splitting"}\n\n'))
        return
      }
      controller.error(new TypeError('terminated'))
    },
  })
}

describe('runAnalysis', () => {
  it('reports a read that fails mid-run in plain words, after the frames already received', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(brokenBody(), { status: 200 })))
    const frames: Frame[] = []

    await expect(
      runAnalysis('x'.repeat(200), (frame) => frames.push(frame), new AbortController().signal),
    ).rejects.toThrow(UNREACHABLE)
    expect(frames).toEqual([{ type: 'node_start', node: 'split', ms: 1, detail: 'Splitting' }])
  })

  it('reports an unreachable server in plain words', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    await expect(runAnalysis('x'.repeat(200), () => undefined, new AbortController().signal)).rejects.toThrow(UNREACHABLE)
  })

  it('shows the server plain message when a start is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: false, error: 'Paste between 200 and 20,000 characters.' }), { status: 400 }),
      ),
    )

    await expect(runAnalysis('short', () => undefined, new AbortController().signal)).rejects.toThrow(
      'Paste between 200 and 20,000 characters.',
    )
  })
})

const FRAME = 'data: {"type":"node_start","node":"split","ms":1,"detail":"Splitting"}\n\n'

/** A body that delivers whatever the test pushes and never ends or errors on its own. */
function openBody(): { body: ReadableStream<Uint8Array>; push: (text: string) => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })
  return { body, push: (text) => controller.enqueue(encoder.encode(text)) }
}

/** Settles with the outcome of runAnalysis without leaving an unhandled rejection behind. */
function track(promise: Promise<void>): { state: () => string } {
  let state = 'pending'
  promise.then(
    () => (state = 'resolved'),
    (e: unknown) => (state = e instanceof Error ? e.message : 'rejected'),
  )
  return { state: () => state }
}

describe('the client watchdog', () => {
  it('gives up with the stalled message when the server never answers, even if fetch ignores its abort signal', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)))

    const run = track(runAnalysis('x'.repeat(200), () => undefined, new AbortController().signal))
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS - 1)
    expect(run.state()).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)

    expect(IDLE_TIMEOUT_MS).toBe(30_000)
    expect(run.state()).toBe(STALLED)
  })

  it('gives up when the stream stalls mid-run, after delivering the frames it had', async () => {
    vi.useFakeTimers()
    const { body, push } = openBody()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))
    const frames: Frame[] = []

    const run = track(runAnalysis('x'.repeat(200), (f) => frames.push(f), new AbortController().signal))
    await vi.advanceTimersByTimeAsync(5_000)
    push(FRAME)
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS - 1)
    expect(run.state()).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)

    expect(frames).toHaveLength(1)
    expect(run.state()).toBe(STALLED)
  })

  it('counts the idle time from the last byte, so a byte at 20 s keeps the run alive past 30 s', async () => {
    vi.useFakeTimers()
    const { body, push } = openBody()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))

    const run = track(runAnalysis('x'.repeat(200), () => undefined, new AbortController().signal))
    await vi.advanceTimersByTimeAsync(20_000)
    push(FRAME)
    await vi.advanceTimersByTimeAsync(14_999)

    expect(run.state()).toBe('pending')
  })

  it('caps the whole run at 35 s even when bytes keep arriving', async () => {
    vi.useFakeTimers()
    const { body, push } = openBody()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))

    const run = track(runAnalysis('x'.repeat(200), () => undefined, new AbortController().signal))
    for (let t = 0; t < OVERALL_TIMEOUT_MS - 5_000; t += 5_000) {
      await vi.advanceTimersByTimeAsync(5_000)
      push(FRAME)
    }
    await vi.advanceTimersByTimeAsync(4_999)
    expect(run.state()).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)

    expect(OVERALL_TIMEOUT_MS).toBe(35_000)
    expect(run.state()).toBe(STALLED)
  })

  it('does not call a Stop a stall', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))),
    )

    const pending = runAnalysis('x'.repeat(200), () => undefined, controller.signal).catch((e: unknown) => e)
    controller.abort()
    const error = (await pending) as Error

    expect(error.message).not.toBe(STALLED)
    expect(controller.signal.aborted).toBe(true)
  })

  it('leaves no timer running after a normal finish', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`${FRAME}data: [DONE]\n\n`, { status: 200 })))

    await runAnalysis('x'.repeat(200), () => undefined, new AbortController().signal)

    expect(vi.getTimerCount()).toBe(0)
  })
})
