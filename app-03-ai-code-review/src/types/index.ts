export type Severity = 'critical' | 'warning' | 'info'

export interface ReviewComment {
  line: number
  severity: Severity
  message: string
  suggestion: string
}

export interface ReviewResult {
  comments: ReviewComment[]
  /** Lines the server counted in the submitted code. Every comment line falls inside it. */
  lineCount: number
  /** True when the model hit its token ceiling, so the comment list may be incomplete. */
  truncated: boolean
}

export type StepStatus = 'ok' | 'failed' | 'skipped'

/** One stage of a review run, timed in milliseconds. */
export interface TraceStep {
  name: string
  status: StepStatus
  ms: number
  detail: string
  tokens?: number
  cost?: number
}

/** Provider-reported usage, summed over the model calls in one run. A field is absent when no call reported it. */
export interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost?: number
}

export interface ReviewRun {
  result: ReviewResult
  trace: TraceStep[]
  usage: Usage | null
  /** The model named in the provider's reply. Null when the reply named none. */
  model: string | null
  totalMs: number
}

export type RunSummary = Omit<ReviewRun, 'result'>

/** 'stopped' is a run the user cancelled. It keeps no result. */
export type RunPhase = 'idle' | 'running' | 'done' | 'failed' | 'stopped'
