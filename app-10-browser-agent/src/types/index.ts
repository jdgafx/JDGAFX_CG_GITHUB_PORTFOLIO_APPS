export const ACTIONS = ['navigate', 'find', 'click', 'type', 'extract', 'verify'] as const
export type StepAction = (typeof ACTIONS)[number]

/** One planned browser step. `url` is set only for navigate steps. `selector` is set only for extract and verify steps. */
export interface BotStep {
  action: StepAction
  target: string
  thought: string
  value?: string
  url?: string
  selector?: string
}

/** What the browser saw. The server captures it after each step. */
export interface ObservedPage {
  url: string
  title: string
  excerpt: string
  /** The CSS selector whose text the excerpt holds. Absent when the excerpt is the page text. */
  region?: string
}

export type TraceStatus = 'ok' | 'failed' | 'skipped'

/** One measured stage. `ms` is measured on the server with Date.now(). */
export interface TraceEntry {
  name: string
  status: TraceStatus
  ms: number
  detail: string
}

/** Provider figures for the planner call. Null means the provider did not report the figure. */
export interface UsageReport {
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  cost: number | null
}

export interface PlanResponse {
  result: { steps: BotStep[] }
  trace: TraceEntry[]
  usage: UsageReport
  model: string | null
  totalMs: number
}

/** Events streamed from /api/execute, in the order the run produces them. */
export type RunEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'stage'; name: string; status: 'ok' | 'failed'; ms: number; detail: string }
  | { type: 'step_start'; index: number; name: string }
  | { type: 'step_complete'; index: number; name: string; status: TraceStatus; ms: number; detail: string; observed?: ObservedPage }
  | { type: 'result'; ms: number; observed: ObservedPage }
  | { type: 'error'; message: string; index: number | null }
  | { type: 'done'; totalMs: number }
