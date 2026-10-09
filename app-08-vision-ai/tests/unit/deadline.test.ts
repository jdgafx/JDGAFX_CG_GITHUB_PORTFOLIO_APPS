import { afterEach, describe, expect, it, vi } from 'vitest'
import { raceAbort, withDeadline } from '../../netlify/shared/deadline'

afterEach(() => {
  vi.useRealTimers()
})

describe('withDeadline', () => {
  it('rejects with a TimeoutError at the limit even when the work ignores the abort', async () => {
    vi.useFakeTimers()
    const outcome = withDeadline(1_000, undefined, () => new Promise<string>(() => {})).catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(999)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toMatchObject({ name: 'TimeoutError' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('forwards a parent abort to the work and rejects with the parent reason', async () => {
    const parent = new AbortController()
    let seen: AbortSignal | undefined
    const outcome = withDeadline(60_000, parent.signal, signal => {
      seen = signal
      return new Promise<string>(() => {})
    }).catch((err: unknown) => err)
    parent.abort()
    expect(await outcome).toMatchObject({ name: 'AbortError' })
    expect(seen?.aborted).toBe(true)
  })

  it('returns the value and leaves no timer behind when the work finishes in time', async () => {
    vi.useFakeTimers()
    await expect(withDeadline(1_000, undefined, async () => 'done')).resolves.toBe('done')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('raceAbort passes the work error through when the signal never aborts', async () => {
    await expect(raceAbort(Promise.reject(new Error('boom')), new AbortController().signal)).rejects.toThrow('boom')
  })
})
