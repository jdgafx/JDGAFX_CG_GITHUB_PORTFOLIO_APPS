import type { StreamEvent } from '../../netlify/shared/events'
import type { NodeName, ReviewPayload, RunResult, ThreadView, TraceRow, TraceStatus } from '../types'

export type NodeStatus = 'idle' | 'running' | 'waiting' | 'done' | 'failed' | 'skipped'

/** Where the page is: nothing started, a run streaming, paused for a person, finished, or failed. */
export type Phase = 'idle' | 'running' | 'paused' | 'done' | 'failed'

export const NODES: readonly NodeName[] = ['intake', 'policy', 'decide', 'review', 'reply']

/** The browser's picture of one run: node states, taken edges, trace rows, the proposal and the result. */
export interface RunView {
  threadId: string | null
  nodes: Record<NodeName, NodeStatus>
  /** Each taken edge as "from>to", with its conditional label when it has one. */
  taken: Record<string, string>
  trace: TraceRow[]
  proposal: ReviewPayload | null
  result: RunResult | null
  error: string | null
}

function idleNodes(): Record<NodeName, NodeStatus> {
  return { intake: 'idle', policy: 'idle', decide: 'idle', review: 'idle', reply: 'idle' }
}

export function emptyRun(threadId: string | null = null): RunView {
  return { threadId, nodes: idleNodes(), taken: {}, trace: [], proposal: null, result: null, error: null }
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
    case 'edge':
      return { ...run, taken: { ...run.taken, [`${event.from}>${event.to}`]: event.label ?? '' } }
    case 'interrupt':
      return { ...run, nodes: { ...run.nodes, review: 'waiting' }, proposal: event.payload }
    case 'result':
      return { ...run, result: event.result, trace: event.result.trace }
    case 'error':
      return { ...run, error: event.message }
  }
}

/** The run view for a thread the visitor opens later, rebuilt from its saved trace and status. */
export function runFromView(view: ThreadView): RunView {
  const nodes = idleNodes()
  for (const row of view.trace) nodes[row.node] = statusOf(row.status)
  if (view.status === 'awaiting_approval') nodes.review = 'waiting'

  const taken: Record<string, string> = {}
  const ran = (node: NodeName) => view.trace.some((row) => row.node === node && row.status === 'ok')
  if (ran('intake') && ran('policy')) taken['intake>policy'] = ''
  if (ran('policy') && ran('decide')) taken['policy>decide'] = ''
  const needsHuman = view.result ? view.result.policy.requiresHuman : (view.proposal?.policy.requiresHuman ?? false)
  if (ran('decide') && needsHuman) taken['decide>review'] = 'requiresHuman'
  if (ran('decide') && !needsHuman) taken['decide>reply'] = 'otherwise'
  if (ran('review')) taken['review>reply'] = ''

  return {
    threadId: view.threadId,
    nodes,
    taken,
    trace: view.trace.filter((row) => row.status !== 'skipped' && row.status !== 'pending'),
    proposal: view.proposal,
    result: view.result,
    error: view.status === 'failed' ? 'This thread stopped before it finished. Its steps are listed in the trace.' : null,
  }
}
