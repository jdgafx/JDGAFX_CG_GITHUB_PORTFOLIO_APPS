import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimeoutError, withTimeout } from '../../src/lib/timeout'

afterEach(() => vi.useRealTimers())

describe('withTimeout', () => {
  it('passes the value through when the work finishes in time, and leaves no timer behind', async () => {
    vi.useFakeTimers()
    await expect(withTimeout(Promise.resolve(7), 1000, 'slow')).resolves.toBe(7)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('passes the work error through unchanged', async () => {
    const boom = new Error('boom')
    await expect(withTimeout(Promise.reject(boom), 1000, 'slow')).rejects.toBe(boom)
  })

  it('rejects with a TimeoutError carrying the message once the limit passes, for work that never settles', async () => {
    vi.useFakeTimers()
    const outcome = withTimeout(new Promise<never>(() => undefined), 30_000, 'Reading this PDF took too long.')
    const seen = outcome.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(29_999)
    let early = true
    void seen.then(() => (early = false))
    await Promise.resolve()
    expect(early).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    const err = await seen
    expect(err).toBeInstanceOf(TimeoutError)
    expect((err as TimeoutError).message).toBe('Reading this PDF took too long.')
  })
})
