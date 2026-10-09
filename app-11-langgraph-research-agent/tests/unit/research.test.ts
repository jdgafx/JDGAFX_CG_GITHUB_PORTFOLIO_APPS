import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Frame } from '../../netlify/shared/events'
import { INTERRUPTED_MESSAGE, STALLED_MESSAGE, streamResearch, WATCHDOG } from '../../src/lib/research'

const frame = (f: Frame) => `data: ${JSON.stringify(f)}\n\n`
const START = frame({ type: 'node_start', node: 'plan', visit: 1, ms: 0 })

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** A response whose body the test feeds by hand and never has to close. */
function openStream() {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return {
    response: new Response(body, { status: 200 }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  }
}

describe('streamResearch watchdog', () => {
  it('says the server stopped responding when no byte comes at all, after 30 seconds and not before', async () => {
    vi.useFakeTimers()
    // A fetch that ignores its signal still must not hold the page forever.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)))
    let settled = false
    const result = streamResearch('Q?', new AbortController().signal, () => undefined).catch((err: unknown) => {
      settled = true
      return err
    })

    await vi.advanceTimersByTimeAsync(WATCHDOG.idleMs - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    expect(await result).toEqual(new Error(STALLED_MESSAGE))
    expect(WATCHDOG).toEqual({ idleMs: 30_000, totalMs: 40_000 })
    expect(STALLED_MESSAGE).toBe('The server stopped responding.')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the frames that arrived, then says the server stopped when the stream stalls mid-way', async () => {
    vi.useFakeTimers()
    const stream = openStream()
    vi.stubGlobal('fetch', vi.fn(async () => stream.response))
    const frames: Frame[] = []
    const result = streamResearch('Q?', new AbortController().signal, (f) => frames.push(f)).catch((err: unknown) => err)

    await vi.advanceTimersByTimeAsync(5_000)
    stream.push(START)
    await vi.advanceTimersByTimeAsync(WATCHDOG.idleMs)

    expect(frames).toEqual([{ type: 'node_start', node: 'plan', visit: 1, ms: 0 }])
    expect(await result).toEqual(new Error(STALLED_MESSAGE))
  })

  it('cuts a stream that keeps sending bytes but outlasts the 40 second cap', async () => {
    vi.useFakeTimers()
    const stream = openStream()
    vi.stubGlobal('fetch', vi.fn(async () => stream.response))
    const result = streamResearch('Q?', new AbortController().signal, () => undefined).catch((err: unknown) => err)

    for (let t = 0; t < 4; t += 1) {
      await vi.advanceTimersByTimeAsync(9_000)
      stream.push(': keep-alive\n\n')
    }
    await vi.advanceTimersByTimeAsync(4_000)

    expect(await result).toEqual(new Error(STALLED_MESSAGE))
  })

  it('stays silent when the visitor presses Stop, on a stall or a stream', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)))
    const visitor = new AbortController()
    const result = streamResearch('Q?', visitor.signal, () => undefined)
    await vi.advanceTimersByTimeAsync(2_000)
    visitor.abort()
    await expect(result).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves a run that finishes in time alone, and clears its timers', async () => {
    vi.useFakeTimers()
    const stream = openStream()
    vi.stubGlobal('fetch', vi.fn(async () => stream.response))
    const frames: Frame[] = []
    const result = streamResearch('Q?', new AbortController().signal, (f) => frames.push(f))
    stream.push(START)
    stream.push('data: [DONE]\n\n')
    stream.close()

    await expect(result).resolves.toBeUndefined()
    expect(frames).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('still reports a stream that ends without [DONE] as interrupted, not as stalled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(START, { status: 200 })),
    )
    await expect(streamResearch('Q?', new AbortController().signal, () => undefined)).rejects.toThrow(INTERRUPTED_MESSAGE)
  })
})
