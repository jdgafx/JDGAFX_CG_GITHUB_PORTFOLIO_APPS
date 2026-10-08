import type { NodeName, ReviewPayload, RunResult, ThreadEntry, ThreadStatus, ThreadView, TraceRow } from '../../src/types'
import { totalsOf } from '../../src/lib/totals'
import { NOT_NEEDED_DETAIL } from './events'
import type { GraphValues } from './state'
import { resolveDecision } from './policy'
import type { StorageKind } from './store'

const NODE_ORDER: readonly NodeName[] = ['intake', 'policy', 'decide', 'review', 'reply']

function missingDetail(node: NodeName, status: ThreadStatus): string {
  if (status === 'failed') return 'Not run: an earlier step failed.'
  if (status === 'awaiting_approval') return node === 'review' ? 'Waiting for a person.' : 'Not run yet.'
  return node === 'review' ? NOT_NEEDED_DETAIL : 'Not run on this path.'
}

/** One row per node in graph order. A node that never ran shows as skipped, so the trace is always complete. */
export function padTrace(rows: readonly TraceRow[], status: ThreadStatus): TraceRow[] {
  return NODE_ORDER.map((node) => {
    const row = rows.filter((candidate) => candidate.node === node).at(-1)
    return row ?? { node, status: 'skipped', ms: 0, detail: missingDetail(node, status) }
  })
}

function requireValue<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`The thread has no ${name}.`)
  return value
}

/** The finished outcome of a completed thread, with the final action and amount after the human answer. */
export function buildResult(threadId: string, values: GraphValues): RunResult {
  const proposal = requireValue(values.decision, 'decision')
  const policy = requireValue(values.policyResult, 'policy result')
  const reply = requireValue(values.replyEmail, 'reply')
  const final = resolveDecision(proposal, values.humanDecision)
  return {
    threadId,
    action: final.action,
    amount: final.amount,
    proposal,
    humanDecision: values.humanDecision,
    reply,
    policy,
    trace: padTrace(values.trace, 'completed'),
    totals: totalsOf(values.trace),
  }
}

export interface ThreadViewInput {
  threadId: string
  entry: ThreadEntry
  storage: StorageKind
  values: GraphValues
  proposal: ReviewPayload | null
}

/** What GET /api/thread returns: status, the pending proposal while waiting, and the result when done. */
export function threadViewOf(input: ThreadViewInput): ThreadView {
  const { entry, values } = input
  const finished = entry.status === 'completed' && values.decision !== null && values.replyEmail !== null
  return {
    threadId: input.threadId,
    title: entry.title,
    status: entry.status,
    updatedAt: entry.updatedAt,
    storage: input.storage,
    proposal: entry.status === 'awaiting_approval' ? input.proposal : null,
    trace: padTrace(values.trace, entry.status),
    result: finished ? buildResult(input.threadId, values) : null,
  }
}
