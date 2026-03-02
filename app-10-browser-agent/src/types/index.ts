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
  pageContent?: string
}

export type SpeedMode = 'slow' | 'normal' | 'fast'
