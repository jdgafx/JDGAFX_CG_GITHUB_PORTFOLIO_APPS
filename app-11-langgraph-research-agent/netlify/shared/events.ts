/**
 * Frames the run sends over SSE, one JSON object per `data:` line. The browser imports
 * these types only, so this file must not import anything that runs on the server.
 */
export type NodeName = 'plan' | 'agent' | 'tools' | 'draft' | 'critic' | 'final'
export type NodeStatus = 'ok' | 'failed' | 'skipped'

export interface FrameUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface SourceView {
  n: number
  title: string
  url: string
}

export interface CriticView {
  verdict: 'accept' | 'revise'
  notes: string
  reviewed: boolean
}

/**
 * How the run ended. `complete`: the path ran to its end. `partial`: the run stopped early or a step
 * was skipped for time, and the answer is the last draft. `no_answer`: it stopped before any draft
 * existed, and `sources` lists the pages read.
 */
export interface EndingView {
  kind: 'complete' | 'partial' | 'no_answer'
  /** Plain words for the page. Empty when the run is complete. */
  message: string
}

export interface Totals {
  ms: number
  tokens?: number
  /** Tokens times the price OpenRouter lists for the model that answered. Absent when no call could be priced. */
  cost?: number
  /** Model calls with no price. When this is above zero, `cost` covers only part of the run. */
  unpricedRows: number
  /** Model calls whose usage never arrived. When this is above zero, `tokens` and `cost` are a floor. */
  unreportedCalls: number
  /** Replies that were refused (not the newest model) but billed. Their cost is in `cost`. */
  refusedCalls: number
}

export interface NodeEndFrame {
  type: 'node_end'
  node: NodeName
  visit: number
  /** Time the node took, in milliseconds. */
  ms: number
  status: NodeStatus
  detail: string
  /** The model the node asked for. */
  model?: string
  /** The model OpenRouter says served the reply, or null when it named none. */
  servedModel?: string | null
  usage?: FrameUsage
  /** Model calls in this step whose usage never arrived (a timeout, a dropped connection, an abort). Absent when none. */
  unreportedCalls?: number
  /** True for a reply refused for coming from a model that is not the newest. Its usage and cost are billed, nothing of its content is shown. */
  refused?: boolean
  /** Where a refused reply's `cost` comes from: `reported` is OpenRouter's usage.cost, `list` is the list price of the served model. */
  costSource?: 'reported' | 'list'
  /** Tokens times the OpenRouter list price of `servedModel`. Absent when the reply named no model or the price could not be had. */
  cost?: number
  /** True for a step a resumed run did not run again: the row is the original run's, with its original time. */
  reused?: boolean
  /** True when the visitor's edit stands in for what the step produced. */
  edited?: boolean
}

/** Where a node can be rewound to. The visitor edits one field there and the steps after it run again. */
export type CheckpointKind = 'plan' | 'critic'

/** Limits on a rewind edit. The server enforces them and the editor shows the counts. */
export const EDIT_LIMITS = { maxQueries: 3, queryChars: 120, notesChars: 300 } as const

/** One saved point of a finished run, as the browser keeps it. The token carries the state; the rest is for display. */
export interface CheckpointOffer {
  kind: CheckpointKind
  /** Which visit of that node the checkpoint sits after (plan) or before (critic). */
  visit: number
  /** The signed state. The browser sends it back unchanged with the edit. */
  token: string
  /** The search queries the plan chose. Present for a plan checkpoint. */
  queries?: string[]
  /** The draft the critic was about to read. Present for a critic checkpoint. */
  draft?: string
  /** Titles of the pages read so far. */
  sources: string[]
}

/** What a resumed run kept and what it ran again. */
export interface ForkInfo {
  kind: CheckpointKind
  visit: number
  reused: number
  rerun: number
}

export interface ResultFrame {
  type: 'result'
  answer: string
  sources: SourceView[]
  critic: CriticView
  /** Every node visit in order, so a repeated node shows up more than once. */
  path: NodeName[]
  evidenceCount: number
  toolRounds: number
  revisions: number
  ending: EndingView
  /** True when the final draft hit its length limit, so the answer may stop mid-sentence. */
  truncated: boolean
  totals: Totals
  models: string[]
  /** Set on a resumed run. Its totals then cover only the steps that ran again. */
  fork?: ForkInfo
}

export type Frame =
  /** The first frame of every run. The id is also in the server log, so a report can quote it. */
  | { type: 'run_start'; runId: string }
  /** `ms` is the offset from the start of the run, not a duration. */
  | { type: 'node_start'; node: NodeName; visit: number; ms: number }
  | NodeEndFrame
  | { type: 'edge'; from: NodeName; to: NodeName; label: string }
  | ResultFrame
  /** Sent after the result of a fresh run: the points the visitor can rewind to. */
  | { type: 'checkpoints'; items: CheckpointOffer[] }
  | { type: 'error'; message: string }

export const DONE_FRAME = 'data: [DONE]\n\n'

/** An SSE comment sent every few seconds. It keeps the stream and any proxy awake, and carries no data. */
export const HEARTBEAT = ': ping\n\n'

/** JSON.stringify escapes newlines, so one frame is always exactly one `data:` line. */
export function encodeFrame(frame: Frame): string {
  return `data: ${JSON.stringify(frame)}\n\n`
}
