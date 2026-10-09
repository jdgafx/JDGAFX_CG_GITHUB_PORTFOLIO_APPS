import type { StreamEvent } from '../../netlify/shared/events'
import { type DuplicateReport, type IssueRef, type NodeName, type ReviewPayload, type RunResult, type ThreadView, type TraceRow, type TraceStatus } from '../types'

export type NodeStatus = 'idle' | 'running' | 'waiting' | 'done' | 'failed' | 'skipped' | 'stopped'

/** Where the page is: nothing started, a run streaming, paused for a person, finished, or failed. */
export type Phase = 'idle' | 'running' | 'paused' | 'done' | 'failed' | 'stopped'

/** The browser's picture of one run: node states, taken edges, trace rows, the proposal and the result. */
export interface RunView {
  threadId: string | null
  /** The issue this run triages, for the line above the graph. */
  issue: IssueRef | null
  nodes: Record<NodeName, NodeStatus>
  /** Each taken edge as "from>to", with its conditional label when it has one. */
  taken: Record<string, string>
  trace: TraceRow[]
  proposal: ReviewPayload | null
  /** The duplicate check, once its step has finished. */
  duplicates: DuplicateReport | null
  result: RunResult | null
  error: string | null
  /** True when the run failed after a thread was created, so the checkpoint may have a step to continue. */
  retryable: boolean
}

function idleNodes(): Record<NodeName, NodeStatus> {
  return { classify: 'idle', duplicates: 'idle', decide: 'idle', review: 'idle', reply: 'idle' }
}

export function emptyRun(issue: IssueRef | null = null, threadId: string | null = null): RunView {
  return { threadId, issue, nodes: idleNodes(), taken: {}, trace: [], proposal: null, duplicates: null, result: null, error: null, retryable: false }
}

/**
 * The steps that were running when the run ended can run no more: after a stop they read stopped, after a failure
 * failed. So no node keeps its halo once the run is over.
 */
export function settleRunning(run: RunView, to: 'stopped' | 'failed'): RunView {
  if (!Object.values(run.nodes).includes('running')) return run
  const nodes = { ...run.nodes }
  for (const name of Object.keys(nodes) as NodeName[]) if (nodes[name] === 'running') nodes[name] = to
  return { ...run, nodes }
}

function statusOf(status: TraceStatus): NodeStatus {
  if (status === 'pending') return 'idle'
  if (status === 'failed') return 'failed'
  if (status === 'skipped') return 'skipped'
  return 'done'
}

/** Folds one server event into the run view. Pure, so the stream logic can be tested without a browser. */
export function applyEvent(run: RunView, event: StreamEvent): RunView {
  switch (event.type) {
    case 'thread':
      return { ...run, threadId: event.threadId }
    case 'node_start':
      return { ...run, nodes: { ...run.nodes, [event.node]: 'running' } }
    case 'node_end':
      return {
        ...run,
        nodes: { ...run.nodes, [event.node]: statusOf(event.status) },
        trace: [
          ...run.trace,
          {
            node: event.node,
            status: event.status,
            ms: event.ms,
            model: event.model,
            usage: event.usage,
            cost: event.cost,
            costSource: event.costSource,
            detail: event.detail,
          },
        ],
      }
    case 'duplicates':
      return { ...run, duplicates: event.report }
    case 'edge':
      return { ...run, taken: { ...run.taken, [`${event.from}>${event.to}`]: event.label ?? '' } }
    case 'interrupt':
      return { ...run, nodes: { ...run.nodes, review: 'waiting' }, proposal: event.payload, duplicates: event.payload.duplicates ?? run.duplicates }
    case 'result':
      return { ...run, result: event.result, duplicates: event.result.duplicates ?? run.duplicates, trace: event.result.trace }
    case 'error':
      return { ...settleRunning(run, 'failed'), error: event.message, retryable: run.threadId !== null }
  }
}

/** The run view for a thread the visitor opens later, rebuilt from its saved trace and status. */
export function runFromView(view: ThreadView): RunView {
  const nodes = idleNodes()
  for (const row of view.trace) nodes[row.node] = statusOf(row.status)
  if (view.status === 'awaiting_approval') nodes.review = 'waiting'

  const taken: Record<string, string> = {}
  const ran = (node: NodeName) => view.trace.some((row) => row.node === node && row.status === 'ok')
  // A run that got as far as decide went through the duplicate check, whether it found anything or not.
  if (ran('classify') && (ran('duplicates') || ran('decide'))) taken['classify>duplicates'] = ''
  if (ran('decide')) taken['duplicates>decide'] = ''
  const needsHuman = view.result ? view.result.triage.requiresHuman : (view.proposal?.triage.requiresHuman ?? false)
  if (ran('decide') && needsHuman) taken['decide>review'] = 'requiresHuman'
  if (ran('decide') && !needsHuman) taken['decide>reply'] = 'otherwise'
  if (ran('review')) taken['review>reply'] = ''

  return {
    threadId: view.threadId,
    issue: { repo: view.issue.repo, number: view.issue.number, title: view.issue.title, htmlUrl: view.issue.htmlUrl },
    nodes,
    taken,
    trace: view.trace.filter((row) => row.status !== 'skipped' && row.status !== 'pending'),
    proposal: view.proposal,
    duplicates: view.duplicates,
    result: view.result,
    retryable: view.status === 'failed' && view.retryable,
    error: view.status === 'failed' ? 'This thread stopped before it finished. Its steps are listed in the trace.' : null,
  }
}
