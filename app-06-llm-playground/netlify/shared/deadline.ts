// Hard time limits for external calls. AbortSignal.timeout alone is not enough: its timer does
// not keep the event loop alive, and a call that ignores the abort can leave a body read pending
// long after the limit. withDeadline runs the whole operation, body read included, against a
// referenced timer and settles at the limit whether or not the work notices the abort.

function reasonOf(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

/** Rejects as soon as `signal` aborts, even if `work` never notices. Settles like `work` otherwise. */
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    work.catch(() => undefined)
    return Promise.reject(reasonOf(signal))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(reasonOf(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/**
 * Runs `run` with a signal that aborts after `ms` or when `parent` aborts. The returned promise
 * rejects at that moment: with a TimeoutError (or `timeoutName`) for the limit, with the parent's
 * own reason for a parent abort. Put the fetch and the body read both inside `run`.
 */
export async function withDeadline<T>(
  ms: number,
  parent: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
  timeoutName: 'TimeoutError' | 'AbortError' = 'TimeoutError',
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('The operation timed out.', timeoutName)), Math.max(0, ms))
  const onParent = () => controller.abort(parent ? reasonOf(parent) : undefined)
  if (parent?.aborted) onParent()
  else parent?.addEventListener('abort', onParent, { once: true })
  try {
    return await raceAbort(run(controller.signal), controller.signal)
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', onParent)
  }
}
