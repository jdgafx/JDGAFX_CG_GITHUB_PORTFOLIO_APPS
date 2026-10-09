/**
 * Frames the run sends over SSE, one JSON object per `data:` line. The browser imports
 * these types only, so this file must not import anything that runs on the server.
 */
export type NodeName = 'plan' | 'agent' | 'tools' | 'draft' | 'critic' | 'final'
export type NodeStatus = 'ok' | 'failed' | 'skipped'
export type CostSource = 'usage' | 'estimated'

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
  cost?: number
  costSource?: CostSource
  /** Model calls with no price. When this is above zero, `cost` covers only part of the run. */
  unpricedRows: number
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
  cost?: number
  costSource?: CostSource
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
}

export type Frame =
  /** The first frame of every run. The id is also in the server log, so a report can quote it. */
  | { type: 'run_start'; runId: string }
  /** `ms` is the offset from the start of the run, not a duration. */
  | { type: 'node_start'; node: NodeName; visit: number; ms: number }
  | NodeEndFrame
  | { type: 'edge'; from: NodeName; to: NodeName; label: string }
  | ResultFrame
  | { type: 'error'; message: string }

export const DONE_FRAME = 'data: [DONE]\n\n'

/** An SSE comment sent every few seconds. It keeps the stream and any proxy awake, and carries no data. */
export const HEARTBEAT = ': ping\n\n'

/** JSON.stringify escapes newlines, so one frame is always exactly one `data:` line. */
export function encodeFrame(frame: Frame): string {
  return `data: ${JSON.stringify(frame)}\n\n`
}
