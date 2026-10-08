/**
 * A signal that aborts when `parent` aborts or after `ms`, whichever comes first.
 * It uses a plain timer, so fake timers can drive it in tests. Call `done` when the
 * guarded work ends, so the timer is cleared and no listener is left behind.
 */
export function deadline(parent: AbortSignal, ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (parent.aborted) controller.abort()
  parent.addEventListener('abort', abort)
  const timer = setTimeout(abort, ms)
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      parent.removeEventListener('abort', abort)
    },
  }
}
