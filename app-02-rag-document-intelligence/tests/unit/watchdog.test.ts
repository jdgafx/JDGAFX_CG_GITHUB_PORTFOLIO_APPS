import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startWatchdog } from '../../src/lib/watchdog'

describe('startWatchdog', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires "idle" when no byte arrives for the idle time', () => {
    const fired = vi.fn()
    startWatchdog(30_000, 90_000, fired)
    vi.advanceTimersByTime(29_999)
    expect(fired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fired).toHaveBeenCalledExactlyOnceWith('idle')
  })

  it('restarts the idle clock on every byte, then fires "cap" at the overall limit', () => {
    const fired = vi.fn()
    const dog = startWatchdog(30_000, 90_000, fired)
    for (let t = 0; t < 8; t++) {
      vi.advanceTimersByTime(10_000)
      dog.kick()
    }
    expect(fired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(fired).toHaveBeenCalledExactlyOnceWith('cap')
  })

  it('stays silent after stop, and fires only once', () => {
    const fired = vi.fn()
    startWatchdog(1_000, 2_000, fired)
    vi.advanceTimersByTime(5_000)
    expect(fired).toHaveBeenCalledTimes(1)
    const quiet = vi.fn()
    startWatchdog(1_000, 2_000, quiet).stop()
    vi.advanceTimersByTime(5_000)
    expect(quiet).not.toHaveBeenCalled()
  })
})
