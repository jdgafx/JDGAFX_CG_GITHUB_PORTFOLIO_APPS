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
