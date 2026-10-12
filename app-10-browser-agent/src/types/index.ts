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

/** A small JPEG of the page as the browser showed it, captured on the server right after the step. `data` is base64. */
export interface StepFrame {
  data: string
  width: number
  height: number
  /** Size of the JPEG in bytes, before base64. */
  bytes: number
}

export type TraceStatus = 'ok' | 'failed' | 'skipped'

/** One measured stage. `ms` is measured on the server with Date.now(). */
export interface TraceEntry {
  name: string
  status: TraceStatus
  ms: number
  detail: string
  /** A model call's billed figures. Null when the call was made but its usage never arrived. Absent on a row that is no billed call. */
  usage?: UsageReport | null
}

/** Provider figures for the planner call. Null means the provider did not report the figure. */
export interface UsageReport {
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  cost: number | null
}

/**
 * How the served model compares with the newest one the model list names. `unchecked` when the list gave no
 * newest model, `not-reported` when the reply named no model.
 */
export type ModelCheck = 'match' | 'mismatch' | 'unchecked' | 'not-reported'

export interface PlanResponse {
  result: { steps: BotStep[] }
  trace: TraceEntry[]
  usage: UsageReport
  /** Planner calls that were made but whose usage never arrived, so the figures are a floor. */
  unreportedCalls: number
  /** The model that served the planner call. Null when the reply named none. */
  model: string | null
  /** The newest model the list says the requested alias resolves to. Null when the list does not say. */
  newestModel: string | null
  modelCheck: ModelCheck
  totalMs: number
}

/** What a failed plan still spent: the billed calls it made, and the model that answered. */
export interface PlanSpend {
  /** Null when no call was answered. */
  usage: UsageReport | null
  unreportedCalls: number
  model: string | null
  newestModel: string | null
  modelCheck: ModelCheck | null
}

/** Events streamed from /api/execute, in the order the run produces them. */
export type RunEvent =
  | { type: 'browser'; version: string }
  | { type: 'stage'; name: string; status: 'ok' | 'failed'; ms: number; detail: string }
  | { type: 'step_start'; index: number; name: string }
  | { type: 'step_complete'; index: number; name: string; status: TraceStatus; ms: number; detail: string; observed?: ObservedPage; frame?: StepFrame; frameNote?: string; frameSameAs?: number }
  | { type: 'result'; ms: number; observed: ObservedPage }
  | { type: 'error'; message: string; index: number | null }
  | { type: 'done'; totalMs: number }
