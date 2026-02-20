export type Severity = 'critical' | 'warning' | 'info'

export interface ReviewComment {
  line: number
  severity: Severity
  message: string
  suggestion: string
}

export interface ReviewResult {
  comments: ReviewComment[]
}
