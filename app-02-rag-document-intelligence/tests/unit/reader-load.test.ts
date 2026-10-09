import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithStallGuard, READER_MESSAGE, ReaderLoadError } from '../../src/lib/readerLoad'

const STALL = 20_000

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** A fetch whose body the test feeds by hand. Like a real fetch, it errors the request when its signal aborts. */
function controlledFetch() {
  const handle: { enqueue: (chunk: Uint8Array) => void; close: () => void } = { enqueue: () => undefined, close: () => undefined }
  const mock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        handle.enqueue = chunk => controller.enqueue(chunk)
        handle.close = () => controller.close()
        init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
      },
    })
    return new Response(body, { status: 200 })
  })
  vi.stubGlobal('fetch', mock)
  return handle
}

describe('fetchWithStallGuard', () => {
  it('lets a worker download that is slow but steady finish, however long it takes in all', async () => {
    vi.useFakeTimers()
    const handle = controlledFetch()
    const outcome = fetchWithStallGuard('/worker.mjs', STALL, 'text/javascript')
    await vi.advanceTimersByTimeAsync(0)
    // 12 chunks, 10 s apart: 120 s in all, never a quiet spell as long as the stall limit.
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(10_000)
      handle.enqueue(new Uint8Array(100))
    }
    handle.close()
    const blob = await outcome
    expect(blob.size).toBe(1200)
    expect(blob.type).toBe('text/javascript')
  })

  it('reports the reader message when no reply ever arrives, at the stall limit and not before', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }),
    ))
    const outcome = fetchWithStallGuard('/worker.mjs', STALL, 'text/javascript').catch((e: unknown) => e)
    let settled = false
    void outcome.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(STALL - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const err = await outcome
    expect(err).toBeInstanceOf(ReaderLoadError)
    expect((err as Error).message).toBe(READER_MESSAGE)
  })

  it('reports the reader message when the download stops partway', async () => {
    vi.useFakeTimers()
    const handle = controlledFetch()
    const outcome = fetchWithStallGuard('/worker.mjs', STALL, 'text/javascript').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_000)
    handle.enqueue(new Uint8Array(10))
    await vi.advanceTimersByTimeAsync(STALL)
    expect(await outcome).toBeInstanceOf(ReaderLoadError)
  })

  it('reports the reader message for an error reply or a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })))
    await expect(fetchWithStallGuard('/worker.mjs', STALL, 'text/javascript')).rejects.toThrow(READER_MESSAGE)
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(fetchWithStallGuard('/worker.mjs', STALL, 'text/javascript')).rejects.toThrow(READER_MESSAGE)
  })
})
