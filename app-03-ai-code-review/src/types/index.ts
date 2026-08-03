export type Severity = 'critical' | 'warning' | 'info'

export interface ReviewComment {
  line: number
  severity: Severity
  message: string
  suggestion: string
}

export interface ReviewResult {
  comments: ReviewComment[]
  /** Lines the server counted in the submitted code — every comment line falls inside it. */
  lineCount: number
  /** True when the model hit its token ceiling and the comment list may be incomplete. */
  truncated: boolean
}
