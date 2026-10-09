import type { NodeName, ReviewPayload, RunResult, TokenUsage, TraceStatus } from '../../src/types'

/** The conditional edges out of decide. The graph and the browser both use these labels. */
export type EdgeLabel = 'requiresHuman' | 'otherwise'

/** One server-sent event. The browser renders them in the order they arrive. */
export type StreamEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'node_start'; node: NodeName; ms: number }
  | {
      type: 'node_end'
      node: NodeName
      ms: number
      status: TraceStatus
      model?: string
      usage?: TokenUsage
      cost?: number
      costSource?: 'usage' | 'estimated'
      detail: string
    }
  | { type: 'edge'; from: NodeName; to: NodeName; label?: EdgeLabel }
  | { type: 'interrupt'; node: 'review'; threadId: string; payload: ReviewPayload }
  | { type: 'result'; result: RunResult }
  | { type: 'error'; message: string }

/** Shown for the review node on an automatic triage, where no maintainer was needed. */
export const NOT_NEEDED_DETAIL = 'Not needed: the rules did not require a maintainer.'

/** The end marker every stream sends last, also after a failure. */
export const DONE_FRAME = 'data: [DONE]\n\n'

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
}

/** One event as a server-sent frame: a data line and a blank line. */
export function encodeFrame(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}
