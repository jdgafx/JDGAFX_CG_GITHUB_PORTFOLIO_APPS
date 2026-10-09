/** Domain types shared by the browser and the Netlify functions. */

/** The graph's steps, in the order they run. Review is skipped when the rules need no maintainer. */
export const NODES = ['classify', 'decide', 'review', 'reply'] as const
export type NodeName = (typeof NODES)[number]

export const ISSUE_TYPES = ['bug', 'feature', 'question', 'docs', 'other'] as const
export type IssueType = (typeof ISSUE_TYPES)[number]

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type Severity = (typeof SEVERITIES)[number]

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

/** The labels a maintainer can pick when editing. The area label ("area: router") comes from the classifier. */
export const LABEL_VOCABULARY = [
  'bug',
  'enhancement',
  'question',
  'documentation',
  'needs-info',
  'possible-duplicate',
  'security',
  'good first issue',
  'help wanted',
] as const

/** GitHub's author_association values. */
export const AUTHOR_ASSOCIATIONS = [
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
  'CONTRIBUTOR',
  'FIRST_TIME_CONTRIBUTOR',
  'FIRST_TIMER',
  'MANNEQUIN',
  'NONE',
] as const
export type AuthorAssociation = (typeof AUTHOR_ASSOCIATIONS)[number]

/** One public GitHub issue as the browser sends it. The server treats every field as untrusted. */
export interface IssueInput {
  /** "owner/name" */
  repo: string
  number: number
  title: string
  body: string
  labels: string[]
  authorAssociation: AuthorAssociation
  /** ISO 8601, UTC, as GitHub reports it. */
  createdAt: string
  /** Always https://github.com/{repo}/issues/{number}. */
  htmlUrl: string
  comments: number
}

/** The part of an issue the cards and the thread list need. */
export interface IssueRef {
  repo: string
  number: number
  title: string
  htmlUrl: string
}

/** What the classify node reads from the issue. The model's JSON is checked against these enums. */
export interface Classification {
  type: IssueType
  /** A short lowercase component name, or an empty string. */
  area: string
  severity: Severity
  unclear: boolean
  duplicateLikely: boolean
  possibleSecurity: boolean
  /** 0 to 1. */
  confidence: number
  summary: string
}

/** The decide node's verdict: whether a maintainer must look, and the labels and priority it proposes. */
export interface Triage {
  requiresHuman: boolean
  /** Why a maintainer must look. Empty on the automatic path. */
  reasons: string[]
  /** One sentence for the card: the reasons joined, or why the rules triaged it alone. */
  reason: string
  labels: string[]
  priority: Priority
}

export type HumanAction = 'approve' | 'edit' | 'reject'

/** The maintainer's answer to the review interrupt. Labels and priority are set only for an edit. */
export interface HumanDecision {
  action: HumanAction
  labels?: string[]
  priority?: Priority
  note?: string
}

/** The drafted maintainer comment. It is shown to the visitor and never posted. */
export interface Reply {
  body: string
}

export type RunStatus = 'running' | 'awaiting_approval' | 'completed'

/** pending marks a node that has not run yet on a thread that is still waiting. */
export type TraceStatus = 'ok' | 'failed' | 'skipped' | 'pending'

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
  issue: IssueRef
  classification: Classification
  triage: Triage
}

export type ThreadStatus = 'awaiting_approval' | 'completed' | 'failed'

/** One row of the thread index the threads card lists. */
export interface ThreadEntry {
  id: string
  title: string
  repo: string
  number: number
  status: ThreadStatus
  updatedAt: string
  /** The priority proposed or applied, or null when none was set. */
  priority: Priority | null
}

/** Totals over the trace rows. Tokens and cost stay null when no node reported them. */
export interface RunTotals {
  nodeMs: number
  tokens: number | null
  cost: number | null
  costSource: 'usage' | 'estimated' | null
  models: string[]
}

/** How the triage was settled: by the rules alone, or by a maintainer's answer. */
export type TriageOutcome = 'auto' | 'approved' | 'edited' | 'rejected'

/** A finished run: the final triage card, the proposal and the maintainer's answer, the draft and the trace. */
export interface RunResult {
  threadId: string
  issue: IssueRef
  outcome: TriageOutcome
  /** Empty when a maintainer rejected the proposal. */
  labels: string[]
  /** Null when a maintainer rejected the proposal. */
  priority: Priority | null
  classification: Classification
  triage: Triage
  humanDecision: HumanDecision | null
  reply: Reply
  /** auto: the rules settled it. human: the graph paused and a maintainer answered. */
  path: 'auto' | 'human'
  trace: TraceRow[]
  totals: RunTotals
}

/** What GET /api/thread returns for one thread. */
export interface ThreadView {
  threadId: string
  title: string
  /** The issue the thread was started with, so opening a thread can show it again. */
  issue: IssueInput
  status: ThreadStatus
  updatedAt: string
  storage: 'blobs' | 'memory'
  proposal: ReviewPayload | null
  /** True for a failed thread whose checkpoint still has a step to run. */
  retryable: boolean
  trace: TraceRow[]
  result: RunResult | null
}
