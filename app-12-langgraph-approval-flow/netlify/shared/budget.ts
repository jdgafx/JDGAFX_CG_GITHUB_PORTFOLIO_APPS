/** The most one request may run. Netlify's synchronous limit is 60 s, which leaves room for the final writes. */
export const RUN_BUDGET_MS = 40_000

/**
 * One request's time budget, counted from when its handler starts. Its signal aborts every call that
 * listens to it. dispose() clears the timer when the request ends before a stream takes over.
 */
export class RunBudget {
  private readonly controller = new AbortController()
  private readonly timer: ReturnType<typeof setTimeout>

  constructor(ms: number = RUN_BUDGET_MS) {
    this.timer = setTimeout(() => this.controller.abort(), ms)
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  dispose(): void {
    clearTimeout(this.timer)
  }
}
