/** Small pure helpers the page uses around a run, kept apart from the components so they can be tested on their own. */

/**
 * Runs `fn` unless an earlier call has not settled yet, so two presses in the same tick start one run. The lock is taken
 * synchronously, before any await, and is released when the call settles, whether it resolves or rejects.
 */
export function singleFlight<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  let inflight = false
  return async (...args: A) => {
    if (inflight) return
    inflight = true
    try {
      await fn(...args)
    } finally {
      inflight = false
    }
  }
}

/**
 * A replay is answered from the recording, so the saved-threads reply it gets back is the recorded list, not the server's.
 * The reply is read so the recording's exchange is used up, nothing from it is kept, and the real list is loaded after.
 */
export async function discardReplayedRead(read: () => Promise<unknown>, loadLive: () => void): Promise<void> {
  try {
    await read()
  } catch {
    // The reply of a replay is never shown, so a failure to read it changes nothing.
  }
  loadLive()
}

/** The step clock while a run is live: the steps that have ended count as the run reports them, plus the running step so far. */
export function stepClockMs(endedStepMs: readonly number[], runningStepMs: number): number {
  return endedStepMs.reduce((sum, ms) => sum + ms, 0) + Math.max(0, runningStepMs)
}
