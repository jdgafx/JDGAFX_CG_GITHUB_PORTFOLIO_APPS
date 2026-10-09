import { NODES, type IssueInput, type NodeName, type ReviewPayload, type RunResult, type ThreadEntry, type ThreadStatus, type ThreadView, type TraceRow } from '../../src/types'
import { totalsOf } from '../../src/lib/totals'
import { NOT_NEEDED_DETAIL } from './events'
import { issueRefOf } from './issue-input'
import type { GraphValues } from './state'
import type { StorageKind } from './store'
import { resolveTriage } from './triage'

function missingDetail(node: NodeName, status: ThreadStatus): string {
  if (status === 'failed') return 'Not run: an earlier step failed.'
  if (status === 'awaiting_approval') return node === 'review' ? 'Waiting for a maintainer.' : 'Not run yet.'
  return node === 'review' ? NOT_NEEDED_DETAIL : 'Not run on this path.'
}

/**
 * One row per node in graph order, so the trace is always complete. A node that never ran is
 * pending while the thread still waits for a maintainer (it will run), and skipped otherwise.
 */
export function padTrace(rows: readonly TraceRow[], status: ThreadStatus): TraceRow[] {
  const missing = status === 'awaiting_approval' ? 'pending' : 'skipped'
  return NODES.map((node) => {
    const row = rows.filter((candidate) => candidate.node === node).at(-1)
    return row ?? { node, status: missing, ms: 0, detail: missingDetail(node, status) }
  })
}

function requireValue<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`The thread has no ${name}.`)
  return value
}

/** The finished triage card of a completed thread, with the labels and priority after the maintainer's answer. */
export function buildResult(threadId: string, values: GraphValues): RunResult {
  const issue = requireValue(values.issue, 'issue')
  const classification = requireValue(values.classification, 'classification')
  const triage = requireValue(values.triage, 'triage')
  const reply = requireValue(values.replyDraft, 'reply')
  const final = resolveTriage(triage, values.humanDecision)
  return {
    threadId,
    issue: issueRefOf(issue),
    outcome: final.outcome,
    labels: final.labels,
    priority: final.priority,
    classification,
    triage,
    humanDecision: values.humanDecision,
    reply,
    path: values.humanDecision ? 'human' : 'auto',
    trace: padTrace(values.trace, 'completed'),
    totals: totalsOf(values.trace),
  }
}

interface ThreadViewInput {
  threadId: string
  entry: ThreadEntry
  storage: StorageKind
  values: GraphValues
  proposal: ReviewPayload | null
  retryable: boolean
}

/** What GET /api/thread returns: status, the pending proposal while waiting, and the result when done. */
export function threadViewOf(input: ThreadViewInput): ThreadView {
  const { entry, values } = input
  const issue: IssueInput = requireValue(values.issue, 'issue')
  const finished = entry.status === 'completed' && values.triage !== null && values.replyDraft !== null
  return {
    threadId: input.threadId,
    title: entry.title,
    issue,
    status: entry.status,
    updatedAt: entry.updatedAt,
    storage: input.storage,
    proposal: entry.status === 'awaiting_approval' ? input.proposal : null,
    retryable: input.retryable,
    trace: padTrace(values.trace, entry.status),
    result: finished ? buildResult(input.threadId, values) : null,
  }
}
