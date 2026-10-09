/**
 * Runs `run` with a signal that aborts when `parent` aborts or after `ms`, and settles by then even
 * when the work ignores its signal: the result races a timer, so a body that never finishes is cut too.
 * The timer is a plain setTimeout, cleared when the work ends. It rejects with a TimeoutError when the
 * limit passes and with an AbortError when the parent aborts first.
 */
export async function withLimit<T>(
  parent: AbortSignal,
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onParentAbort: (() => void) | undefined

  const cutOff = new Promise<never>((_resolve, reject) => {
    const stop = (reason: DOMException) => {
      controller.abort(reason)
      reject(reason)
    }
    timer = setTimeout(() => stop(new DOMException(`Timed out after ${ms} ms.`, 'TimeoutError')), ms)
    onParentAbort = () => stop(new DOMException('The run signal aborted.', 'AbortError'))
    if (parent.aborted) onParentAbort()
    else parent.addEventListener('abort', onParentAbort, { once: true })
  })

  try {
    return await Promise.race([run(controller.signal), cutOff])
  } finally {
    clearTimeout(timer)
    if (onParentAbort) parent.removeEventListener('abort', onParentAbort)
  }
}
