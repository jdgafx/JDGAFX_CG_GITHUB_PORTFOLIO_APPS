import { vi } from 'vitest'

/**
 * Advances fake timers one second at a time until the promise settles, so a timer that a call creates
 * late in its chain still fires. Use only after vi.useFakeTimers has been called.
 */
export async function untilSettled<T>(pending: Promise<T>, maxSeconds = 120): Promise<T> {
  let settled = false
  const tracked = pending.finally(() => {
    settled = true
  })
  for (let second = 0; second < maxSeconds && !settled; second += 1) {
    await vi.advanceTimersByTimeAsync(1_000)
  }
  return tracked
}
