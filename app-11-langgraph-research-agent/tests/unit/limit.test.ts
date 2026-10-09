import { afterEach, describe, expect, it, vi } from 'vitest'
import { withLimit } from '../../netlify/shared/limit'
import { isAbortError, isTimeoutError } from '../../netlify/shared/json'

afterEach(() => {
  vi.useRealTimers()
})

describe('withLimit', () => {
  it('returns the result and leaves no timer behind', async () => {
    vi.useFakeTimers()
    const result = await withLimit(new AbortController().signal, 5_000, async () => 'done')
    expect(result).toBe('done')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects with a TimeoutError at the limit even when the work ignores its signal', async () => {
    vi.useFakeTimers()
    const pending = withLimit(new AbortController().signal, 5_000, () => new Promise<string>(() => undefined)).catch(
      (err: unknown) => err,
    )
    await vi.advanceTimersByTimeAsync(5_000)
    const error = await pending
    expect(isTimeoutError(error)).toBe(true)
    expect(isAbortError(error)).toBe(true)
  })

  it('aborts the signal the work received when the limit passes', async () => {
    vi.useFakeTimers()
    let seen: AbortSignal | undefined
    const pending = withLimit(new AbortController().signal, 1_000, (signal) => {
      seen = signal
      return new Promise<string>(() => undefined)
    }).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(1_000)
    await pending
    expect(seen?.aborted).toBe(true)
  })

  it('rejects with an AbortError, not a TimeoutError, when the parent aborts first, and clears its timer', async () => {
    vi.useFakeTimers()
    const parent = new AbortController()
    const pending = withLimit(parent.signal, 5_000, () => new Promise<string>(() => undefined)).catch((err: unknown) => err)
    parent.abort()
    const error = await pending
    expect(isAbortError(error)).toBe(true)
    expect(isTimeoutError(error)).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects at once when the parent is already aborted', async () => {
    const parent = new AbortController()
    parent.abort()
    const error = await withLimit(parent.signal, 5_000, () => new Promise<string>(() => undefined)).catch((err: unknown) => err)
    expect(isAbortError(error)).toBe(true)
  })
})
