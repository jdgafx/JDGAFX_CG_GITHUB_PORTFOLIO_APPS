import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLEANUP_MS, CLOSE_MS } from '../../src/lib/budget'
import { closeBrowser, type Launched } from '../../netlify/shared/session'

// The cleanup after a close reads /proc and /tmp. Here every read answers at once, or a read of the folder list never answers, like a stuck disk.
const fsState = vi.hoisted(() => ({ hang: false }))
vi.mock('node:fs/promises', () => ({
  readdir: () => (fsState.hang ? new Promise<never>(() => undefined) : Promise.resolve([])),
  statfs: async () => ({ bavail: 1_000_000, bsize: 4_096 }),
  lstat: async () => { throw new Error('none') },
  readFile: async () => { throw new Error('none') },
  rm: async () => undefined,
}))

afterEach(() => {
  fsState.hang = false
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function launchedWith(close: () => Promise<void>): Launched {
  return { browser: { close } as unknown as Launched['browser'], executablePath: '/test-only/no-such-chromium', version: '1.0.0.0', unpackMs: 0 }
}

async function settleTime(work: Promise<unknown>, maxMs: number): Promise<number | null> {
  const start = Date.now()
  let at: number | null = null
  work.then(() => { at = Date.now() - start }, () => { at = Date.now() - start })
  await vi.advanceTimersByTimeAsync(maxMs)
  return at
}

describe('closing the browser', () => {
  it('gives up on a browser that does not close at the shared close limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const closing = closeBrowser(launchedWith(() => new Promise<never>(() => undefined)))
    const at = await settleTime(closing, CLOSE_MS + 1_000)
    expect(at).toBe(CLOSE_MS)
    expect((await closing).closed).toBe(false)
  })

  it('gives up on a cleanup that does not answer at the shared cleanup limit, and still reports the close', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fsState.hang = true
    const closing = closeBrowser(launchedWith(async () => undefined))
    const at = await settleTime(closing, CLEANUP_MS + 1_000)
    expect(at).toBe(CLEANUP_MS)
    expect((await closing).closed).toBe(true)
  })
})
