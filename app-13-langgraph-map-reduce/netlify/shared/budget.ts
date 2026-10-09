import { RunBudgetError } from './errors'

/** A signal that aborts as soon as any of the given signals does, and carries that signal's reason. */
export function anySignal(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

/** Resolves after `ms`. Rejects at once with the signal's reason if the signal aborts first. */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * One budget for a whole run. The deadline passing, a cancel or a halt aborts `signal`, and every model
 * call and every queued call in the run listens to that one signal. A halt is a fatal error in one
 * branch: it stops the other branches at once, and the first cause is the one that gets reported.
 */
export class RunBudget {
  private readonly deadline = new AbortController()
  private readonly halts = new AbortController()
  private readonly started = Date.now()
  private readonly limitMs: number
  private readonly timer: ReturnType<typeof setTimeout>
  private cause: { error: unknown } | null = null
  /** Aborts on the deadline, on a cancel, or on a halt. */
  readonly signal: AbortSignal

  constructor(limitMs: number) {
    this.limitMs = limitMs
    this.signal = anySignal(this.deadline.signal, this.halts.signal)
    this.timer = setTimeout(() => this.deadline.abort(new RunBudgetError()), limitMs)
  }

  /** Milliseconds since the run started. */
  elapsed(): number {
    return Date.now() - this.started
  }

  /** Milliseconds left before the time limit, never below zero. */
  remaining(): number {
    return Math.max(0, this.limitMs - this.elapsed())
  }

  /** True only when the time limit has passed or the run was cancelled. A halt does not count. */
  expired(): boolean {
    return this.deadline.signal.aborted
  }

  /** Stops the run now, for example when the client disconnects. */
  cancel(): void {
    this.deadline.abort(new RunBudgetError())
  }

  /** Stops every other call in the run at once. The first cause is kept, so it is the one reported. */
  halt(error: unknown): void {
    if (this.cause === null) this.cause = { error }
    this.halts.abort(error)
  }

  halted(): boolean {
    return this.cause !== null
  }

  /** The error that halted the run, or null when nothing has halted it. */
  haltCause(): unknown {
    return this.cause === null ? null : this.cause.error
  }

  dispose(): void {
    clearTimeout(this.timer)
  }
}

export interface Limiter {
  run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T>
}

/**
 * Runs at most `limit` tasks at once. A queued task starts when a slot is handed to it. A queued
 * task whose signal aborts is rejected with the signal's reason and never starts.
 */
export function createLimiter(limit: number): Limiter {
  let active = 0
  const waiting: Array<() => void> = []

  const release = (): void => {
    const next = waiting.shift()
    if (next) next()
    else active -= 1
  }

  const waitForSlot = (signal: AbortSignal): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const index = waiting.indexOf(wake)
        if (index >= 0) waiting.splice(index, 1)
        reject(signal.reason)
      }
      const wake = (): void => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }
      waiting.push(wake)
      signal.addEventListener('abort', onAbort, { once: true })
    })

  return {
    async run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
      if (signal.aborted) throw signal.reason
      if (active < limit) active += 1
      else await waitForSlot(signal)
      try {
        return await task()
      } finally {
        release()
      }
    },
  }
}
