export type StepAction = 'navigate' | 'find' | 'click' | 'type' | 'extract' | 'verify'

export type PageContentType =
  | 'flights-search' | 'flights-results'
  | 'job-board' | 'job-results'
  | 'ecommerce' | 'ecommerce-results'
  | 'form' | 'search-results' | 'generic'

export interface BotStep {
  action: StepAction
  target: string
  value?: string
  thought: string
  url?: string
  pageContent?: PageContentType
}

export type SpeedMode = 'slow' | 'normal' | 'fast'

/** Named input on the mock page that a "type" step is aimed at. */
export type FieldKey =
  | 'origin' | 'destination' | 'date'
  | 'name' | 'email' | 'phone' | 'experience'
  | 'search'

/** Text committed to each mock input so far in the run. */
export type FieldValues = Partial<Record<FieldKey, string>>

/** One row of extracted data, shared by the mock page and the results panel. */
export interface ResultRow {
  title: string
  detail?: string
  value?: string
}

export type ExecutionEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'step_start'; index: number; step: BotStep; url: string }
  | { type: 'step_complete'; index: number; url: string; title: string; excerpt: string }
  | { type: 'result'; url: string; title: string; excerpt: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

export interface ExecutionResult {
  sessionId?: string
  url?: string
  title?: string
  excerpt?: string
}
