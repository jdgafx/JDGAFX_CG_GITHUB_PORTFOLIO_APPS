// A hard time limit for an external call. AbortSignal.timeout alone is not enough: a call that ignores the
// abort can leave a body read pending long after the limit. withDeadline runs the whole operation, body read
// included, against a referenced timer and settles at the limit whether or not the work notices the abort.

/** Runs `run` with a signal that aborts after `ms`. The returned promise rejects with a TimeoutError at that moment. */
export function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const reason = new DOMException('The operation timed out.', 'TimeoutError')
      controller.abort(reason)
      reject(reason)
    }, ms)
    run(controller.signal).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
