import type { NodeName } from '../types'
import type { Phase } from './run-state'

/** What the page knows about the stream that is open: whether it continues a paused thread, and whether it has sent anything yet. */
export interface StreamFlow {
  resuming: boolean
  eventsArrived: boolean
}

export const NO_STREAM: StreamFlow = { resuming: false, eventsArrived: false }

/** The status line while a run is streaming. Each wording matches what is really happening. */
export function runningLine(current: NodeName | null, flow: StreamFlow): string {
  if (flow.resuming && !flow.eventsArrived) return 'Sending your decision.'
  if (current) return `Running the ${current} step.`
  return flow.eventsArrived ? 'Running the refund.' : 'Starting the refund run.'
}

/**
 * Whether the approval card is on the page. It stays, disabled, while a decision is on its way and
 * the server has not answered yet, so a failed send returns to the same card with what was typed.
 */
export function approvalVisible(phase: Phase, flow: StreamFlow, hasProposal: boolean): boolean {
  if (!hasProposal) return false
  return phase === 'paused' || (phase === 'running' && flow.resuming && !flow.eventsArrived)
}
