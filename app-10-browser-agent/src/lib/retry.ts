import { RequestFailure } from './api'

/** How long the page waits before it starts the run a second time. */
export const RETRY_DELAY_MS = 800

/**
 * Whether a run that did not finish should be started once more. It should when this was the first attempt, no step
 * had finished, the server had not reported an outcome of its own, and the failure was a server or gateway error or
 * a cut connection (or the stream simply ended). A 4xx, a 429, a stalled stream and a visitor's Stop are final.
 */
export function shouldRetryRun(attempt: number, progressed: boolean, concluded: boolean, error?: unknown): boolean {
  if (attempt > 0 || progressed || concluded) return false
  if (error === undefined) return true
  return error instanceof RequestFailure && error.retryable
}
