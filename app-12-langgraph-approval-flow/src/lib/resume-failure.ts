import { RequestFailure } from './api'
import type { Phase } from './run-state'

/** Shown when a decision never reached the server and the thread is still waiting. */
export const DECISION_NOT_SENT = 'The decision did not reach the server. The run is still waiting, so try again.'

export interface FailedStream {
  /** The phase before the stream opened: paused for a resume, idle or finished for a new run. */
  from: Phase
  /** True once any event of this stream arrived. */
  eventsArrived: boolean
  /** True for a resume stream, false for a new run. */
  resuming: boolean
  error: unknown
}

export interface FailureOutcome {
  phase: Phase
  /** The plain message to show, or null to use the usual text for the error. */
  message: string | null
}

/**
 * Where the page goes when a stream throws. A resume that failed before any event, through a lost
 * connection or a server error, never reached the thread, so the page stays paused with the
 * approval card. A rate limit (429) never reached the thread either, so the card stays and the
 * server's own plain message is shown. Every other failure, including a 4xx such as "not awaiting
 * approval", is a failed run.
 */
export function outcomeAfterFailure({ from, eventsArrived, resuming, error }: FailedStream): FailureOutcome {
  if (!(error instanceof RequestFailure) || !resuming || from !== 'paused' || eventsArrived) {
    return { phase: 'failed', message: null }
  }
  if (error.connection || (error.status !== undefined && error.status >= 500)) {
    return { phase: 'paused', message: DECISION_NOT_SENT }
  }
  if (error.status === 429) return { phase: 'paused', message: null }
  return { phase: 'failed', message: null }
}
