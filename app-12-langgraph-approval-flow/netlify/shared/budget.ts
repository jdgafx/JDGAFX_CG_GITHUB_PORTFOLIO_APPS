// Every time limit the page and the functions must agree on. The functions end their own work by these numbers
// and the page derives its waits from them, so the two sides cannot drift apart.

/** Added to a server worst case for the network and a cold start. */
export const CLIENT_MARGIN_MS = 3_000
/** The platform closes these functions near 30 s in practice. */
export const PLATFORM_CUT_MS = 30_000

/** The most one request may run before its model and store calls are cut. Netlify closes these functions near 30 s, so the server ends the stream itself first. */
export const RUN_BUDGET_MS = 25_000
/**
 * After the budget the run still writes the thread's summary and frees its claim, then sends the closing frame. Those
 * writes share this extra time: every store call of the request is cut at the end of it.
 */
export const CLOSE_GRACE_MS = 2_000
/** The longest a request takes from its handler starting to its last frame. */
export const REQUEST_WORST_MS = RUN_BUDGET_MS + CLOSE_GRACE_MS

/** The claim and the checkpoint read before the stream opens end by this time, or the request is refused with the store message. */
export const PRE_STREAM_MS = 6_000
/** Freeing the claim of a refused request: two store calls of this long at most. */
export const PRE_STREAM_RELEASE_CALL_MS = 1_000
/** The longest the page waits for a response to begin: the work before the stream, and the release of a claim it took. */
export const PRE_STREAM_WORST_MS = PRE_STREAM_MS + 2 * PRE_STREAM_RELEASE_CALL_MS

/** How long the page waits for a response to begin. */
export const CONNECT_WAIT_MS = PRE_STREAM_WORST_MS + CLIENT_MARGIN_MS
/** How long the page waits for a whole request. It stays within the platform's cut. */
export const OVERALL_WAIT_MS = REQUEST_WORST_MS + CLIENT_MARGIN_MS

/**
 * One request's time budget, counted from when its handler starts. Its signal aborts every call that
 * listens to it. Two more signals bound the work around the stream: `preStreamSignal` ends the work before the
 * stream opens, and `closeSignal` ends the closing writes once the budget and its grace are used up.
 * dispose() clears the timers when the request ends.
 */
export class RunBudget {
  private readonly controller = new AbortController()
  private readonly pre = new AbortController()
  private readonly closing = new AbortController()
  private readonly timers: Array<ReturnType<typeof setTimeout>>
  private readonly endsAt: number

  constructor(ms: number = RUN_BUDGET_MS) {
    this.endsAt = Date.now() + ms
    this.timers = [
      setTimeout(() => this.controller.abort(), ms),
      setTimeout(() => this.pre.abort(), Math.min(PRE_STREAM_MS, ms)),
      setTimeout(() => this.closing.abort(), ms + CLOSE_GRACE_MS),
    ]
  }

  /** Milliseconds left in the budget, never below zero. */
  remainingMs(): number {
    return Math.max(0, this.endsAt - Date.now())
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  /** Aborts at the end of the pre-stream time, or with the budget if that is shorter. */
  get preStreamSignal(): AbortSignal {
    return AbortSignal.any([this.controller.signal, this.pre.signal])
  }

  /** Aborts when the budget and the closing grace are both used up. */
  get closeSignal(): AbortSignal {
    return this.closing.signal
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer)
  }
}
