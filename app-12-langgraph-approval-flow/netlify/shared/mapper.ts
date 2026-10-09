import { NODES, PRIORITIES, type DuplicateReport, type NodeName, type Priority, type ReviewPayload, type TraceRow } from '../../src/types'
import { NOT_NEEDED_DETAIL, type EdgeLabel, type StreamEvent } from './events'
import { isRecord } from './guard'

const INTERRUPT_KEY = '__interrupt__'

function isNodeName(value: string): value is NodeName {
  return (NODES as readonly string[]).includes(value)
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/** The review payload the graph passes to interrupt(), checked field by field before the browser sees it. */
function isReviewPayload(value: unknown): value is ReviewPayload {
  if (!isRecord(value) || !isRecord(value.issue) || !isRecord(value.classification) || !isRecord(value.triage)) return false
  const { issue, classification, triage } = value
  return (
    typeof issue.repo === 'string' &&
    typeof issue.number === 'number' &&
    typeof issue.title === 'string' &&
    typeof issue.htmlUrl === 'string' &&
    typeof classification.type === 'string' &&
    typeof classification.severity === 'string' &&
    typeof classification.confidence === 'number' &&
    typeof classification.summary === 'string' &&
    typeof triage.requiresHuman === 'boolean' &&
    typeof triage.reason === 'string' &&
    isStringList(triage.reasons) &&
    isStringList(triage.labels) &&
    typeof triage.priority === 'string' &&
    (PRIORITIES as readonly string[]).includes(triage.priority)
  )
}

function traceRowsOf(value: unknown): TraceRow[] {
  if (!isRecord(value) || !Array.isArray(value.trace)) return []
  return value.trace as TraceRow[]
}

/**
 * Turns the graph's stream chunks into the frames the browser renders. Custom chunks announce a
 * node's start. Update chunks carry each finished node's trace row, which becomes node_end, and
 * the interrupt. Edges are taken from the graph's own order and from triage.requiresHuman.
 */
export class FrameMapper {
  /** True once the run has paused at the review interrupt. */
  paused = false
  /** The priority proposed at the pause, recorded in the thread index. */
  proposalPriority: Priority | null = null
  /** The interrupt frame, held back so the caller can send it last, after the thread is saved and released. */
  interruptEvent: StreamEvent | null = null
  private current: { node: NodeName; startedAt: number } | null = null
  private requiresHuman = false

  constructor(
    private readonly threadId: string,
    private readonly send: (event: StreamEvent) => void,
    private readonly startedAt: number = Date.now(),
  ) {}

  /** The node that started and has not finished, for an error message that names the step. */
  get currentNode(): NodeName | null {
    return this.current?.node ?? null
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
    if (node === 'decide' && isRecord(value) && isRecord(value.triage)) {
      this.requiresHuman = value.triage.requiresHuman === true
    }
    this.current = null
    if (node === 'duplicates' && isRecord(value) && isRecord(value.duplicateReport)) {
      this.send({ type: 'duplicates', report: value.duplicateReport as unknown as DuplicateReport })
    }
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
      case 'classify':
        this.edge('classify', 'duplicates')
        return
      case 'duplicates':
        this.edge('duplicates', 'decide')
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
    this.proposalPriority = payload.triage.priority
    this.interruptEvent = { type: 'interrupt', node: 'review', threadId: this.threadId, payload }
  }

  private edge(from: NodeName, to: NodeName, label?: EdgeLabel): void {
    this.send(label ? { type: 'edge', from, to, label } : { type: 'edge', from, to })
  }
}
