/** Domain types shared by the browser and the Netlify functions. */

export type Issue = 'duplicate_charge' | 'defective_item' | 'other'

/** What the intake node reads from the ticket. Null means the ticket did not say. */
export interface Extracted {
  orderId: string | null
  issue: Issue
  requestedAmount: number | null
}

/** The deterministic policy verdict. Dollars, not cents. */
export interface PolicyResult {
  eligible: boolean
  reason: string
  amount: number
  requiresHuman: boolean
}

export type DecisionAction = 'refund' | 'deny'

/** The proposal. Action and amount come from the policy; the model only writes the rationale. */
export interface Decision {
  action: DecisionAction
  amount: number
  rationale: string
}

export type HumanAction = 'approve' | 'edit' | 'reject'

/** The human's answer to the review interrupt. Amount is set only for an edit. */
export interface HumanDecision {
  action: HumanAction
  amount?: number
  note?: string
}

export interface Reply {
  subject: string
  body: string
}

export type NodeName = 'intake' | 'policy' | 'decide' | 'review' | 'reply'

export type RunStatus = 'running' | 'awaiting_approval' | 'completed'

export type TraceStatus = 'ok' | 'failed' | 'skipped'

export interface TokenUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

/** One finished node, as kept in the graph state and shown in the run trace. */
export interface TraceRow {
  node: NodeName
  status: TraceStatus
  ms: number
  model?: string
  usage?: TokenUsage
  cost?: number
  costSource?: 'usage' | 'estimated'
  detail: string
}

/** The payload the review node passes to interrupt(). It is what the approval card shows. */
export interface ReviewPayload {
  proposal: Decision
  policy: PolicyResult
  orderId: string | null
  orderTotal: number | null
  requestedAmount: number | null
}

export type ThreadStatus = 'awaiting_approval' | 'completed' | 'failed'

/** One row of the thread index the threads card lists. */
export interface ThreadEntry {
  id: string
  title: string
  status: ThreadStatus
  updatedAt: string
  amount: number | null
}

/** Totals over the trace rows. Tokens and cost stay null when no node reported them. */
export interface RunTotals {
  nodeMs: number
  tokens: number | null
  cost: number | null
  costSource: 'usage' | 'estimated' | null
  models: string[]
}

/** A finished run: the outcome, the proposal and the human answer, the reply and the trace. */
export interface RunResult {
  threadId: string
  action: DecisionAction
  amount: number
  proposal: Decision
  humanDecision: HumanDecision | null
  reply: Reply
  policy: PolicyResult
  trace: TraceRow[]
  totals: RunTotals
}

/** What GET /api/thread returns for one thread. */
export interface ThreadView {
  threadId: string
  title: string
  status: ThreadStatus
  updatedAt: string
  storage: 'blobs' | 'memory'
  proposal: ReviewPayload | null
  trace: TraceRow[]
  result: RunResult | null
}
