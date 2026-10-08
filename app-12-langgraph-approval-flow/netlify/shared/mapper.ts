import type { NodeName, ReviewPayload, TraceRow } from '../../src/types'
import { NOT_NEEDED_DETAIL, type EdgeLabel, type StreamEvent } from './events'
import { isRecord } from './guard'

const NODES: readonly NodeName[] = ['intake', 'policy', 'decide', 'review', 'reply']
const INTERRUPT_KEY = '__interrupt__'

function isNodeName(value: string): value is NodeName {
  return (NODES as readonly string[]).includes(value)
}

/** The review payload the graph passes to interrupt(), checked field by field before the browser sees it. */
function isReviewPayload(value: unknown): value is ReviewPayload {
  if (!isRecord(value) || !isRecord(value.proposal) || !isRecord(value.policy)) return false
  const { proposal, policy } = value
  return (
    typeof proposal.action === 'string' &&
    typeof proposal.amount === 'number' &&
    typeof proposal.rationale === 'string' &&
    typeof policy.eligible === 'boolean' &&
    typeof policy.reason === 'string' &&
    typeof policy.amount === 'number' &&
    typeof policy.requiresHuman === 'boolean' &&
    (value.orderId === null || typeof value.orderId === 'string') &&
    (value.orderTotal === null || typeof value.orderTotal === 'number') &&
    (value.requestedAmount === null || typeof value.requestedAmount === 'number')
  )
}

function traceRowsOf(value: unknown): TraceRow[] {
  if (!isRecord(value) || !Array.isArray(value.trace)) return []
  return value.trace as TraceRow[]
}

/**
 * Turns the graph's stream chunks into the frames the browser renders. Custom chunks announce a
 * node's start. Update chunks carry each finished node's trace row, which becomes node_end, and
 * the interrupt. Edges are taken from the graph's own order and from policy.requiresHuman.
 */
export class FrameMapper {
  /** True once the run has paused at the review interrupt. */
  paused = false
  /** The proposal amount at the pause, recorded in the thread index. */
  proposalAmount: number | null = null
  private current: { node: NodeName; startedAt: number } | null = null
  private requiresHuman = false
  private readonly threadId: string
  private readonly send: (event: StreamEvent) => void
  private readonly startedAt: number

  constructor(threadId: string, send: (event: StreamEvent) => void, startedAt: number = Date.now()) {
    this.threadId = threadId
    this.send = send
    this.startedAt = startedAt
  }

  onCustom(chunk: unknown): void {
    if (!isRecord(chunk) || chunk.type !== 'node_start' || typeof chunk.node !== 'string') return
    if (!isNodeName(chunk.node)) return
    this.current = { node: chunk.node, startedAt: Date.now() }
    this.send({ type: 'node_start', node: chunk.node, ms: Date.now() - this.startedAt })
  }

  onUpdates(chunk: unknown): void {
    if (!isRecord(chunk)) return
    for (const [key, value] of Object.entries(chunk)) {
      if (key === INTERRUPT_KEY) this.onInterrupt(value)
      else if (isNodeName(key)) this.onNodeEnd(key, value)
    }
  }

  /** The run stopped with an error: the node that was running is reported as failed with the message. */
  failCurrent(message: string): void {
    if (!this.current) return
    this.send({
      type: 'node_end',
      node: this.current.node,
      ms: Date.now() - this.current.startedAt,
      status: 'failed',
      detail: message,
    })
    this.current = null
  }

  private onNodeEnd(node: NodeName, value: unknown): void {
    if (node === 'policy' && isRecord(value) && isRecord(value.policyResult)) {
      this.requiresHuman = value.policyResult.requiresHuman === true
    }
    this.current = null
    const row = traceRowsOf(value).at(-1)
    if (row) {
      this.send({
        type: 'node_end',
        node,
        ms: row.ms,
        status: row.status,
        model: row.model,
        usage: row.usage,
        cost: row.cost,
        costSource: row.costSource,
        detail: row.detail,
      })
    }
    this.sendEdgesAfter(node)
  }

  private sendEdgesAfter(node: NodeName): void {
    switch (node) {
      case 'intake':
        this.edge('intake', 'policy')
        return
      case 'policy':
        this.edge('policy', 'decide')
        return
      case 'decide':
        if (this.requiresHuman) {
          this.edge('decide', 'review', 'requiresHuman')
          return
        }
        this.edge('decide', 'reply', 'otherwise')
        this.send({ type: 'node_end', node: 'review', ms: 0, status: 'skipped', detail: NOT_NEEDED_DETAIL })
        return
      case 'review':
        this.edge('review', 'reply')
        return
      case 'reply':
        return
    }
  }

  private onInterrupt(value: unknown): void {
    const first: unknown = Array.isArray(value) ? value[0] : undefined
    const payload: unknown = isRecord(first) ? first.value : undefined
    if (!isReviewPayload(payload)) return
    this.paused = true
    this.proposalAmount = payload.proposal.amount
    this.send({ type: 'interrupt', node: 'review', threadId: this.threadId, payload })
  }

  private edge(from: NodeName, to: NodeName, label?: EdgeLabel): void {
    this.send(label ? { type: 'edge', from, to, label } : { type: 'edge', from, to })
  }
}
