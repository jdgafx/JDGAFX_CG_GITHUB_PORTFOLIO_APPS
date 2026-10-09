export type Severity = 'critical' | 'warning' | 'info'

/**
 * What the second pass and the checks decided about a first-pass comment.
 * kept: confirmed on its line. moved: confirmed, on a different line than the first pass cited.
 * dropped: removed, and listed with its reason. unverified: the second pass could not confirm it.
 */
export type Verdict = 'kept' | 'moved' | 'dropped' | 'unverified'

/** Who settled the verdict: the second model pass, a deterministic check, or nobody (unverified). */
export type Decider = 'verifier' | 'check' | 'none'

/** Where a pull request comment sits in the diff: the file and the line number on the new (or, for a removed line, old) side. */
export interface DiffLocation {
  file: string
  line: number
  side: 'new' | 'old'
}

export interface ReviewComment {
  /** Position in the first pass, from 1. Stable, so a dropped comment can be matched to the first pass. */
  id: number
  /** The numbered line the comment sits on now. For a dropped comment, the line it was filed on. */
  line: number
  /** The line the first pass cited. */
  fromLine: number
  severity: Severity
  message: string
  suggestion: string
  verdict: Verdict
  decidedBy: Decider
  /** One line on why, quoting the code where the decision rests. */
  reason: string
  /** The code the reason quotes, found on or near the line by the checks. Null when none was checked. */
  evidence: string | null
  /** The text of the line the comment sits on, as the reviewer saw it (a diff line starts with + or -). */
  code: string
  /** The file and line in the pull request, in pull request mode. */
  where: DiffLocation | null
}

export type SkipReason = 'no-patch' | 'generated' | 'too-large' | 'not-selected'

/** One pull request file and whether it went into the review. */
export interface PrFileAccount {
  path: string
  status: string
  /** Added and removed lines in the patch. */
  changed: number
  /** Characters the file adds to the numbered diff. */
  chars: number
  included: boolean
  skipped: SkipReason | null
}

export interface PrAccount {
  files: PrFileAccount[]
  filesIncluded: number
  filesTotal: number
  changedIncluded: number
  charsIncluded: number
  charLimit: number
}

/** The size of the diff a pull request review read, as the server counted it. */
export interface PrCounts {
  filesIncluded: number
  changedIncluded: number
  charsIncluded: number
  charLimit: number
}

export interface ReviewResult {
  comments: ReviewComment[]
  /** Numbered lines the reviewer saw. Every comment line falls inside it. */
  lineCount: number
  /** True when the first pass hit its token ceiling, so the comment list may be incomplete. */
  truncated: boolean
  /** True when the second pass ran. False means every surviving comment is unverified. */
  verified: boolean
  /** First-pass items that could not be shown at all (no readable line, severity or text). */
  malformed: number
  mode: 'file' | 'pr'
  pr: PrCounts | null
}

export type StepStatus = 'ok' | 'failed' | 'skipped'

/** One stage of a review run, timed in milliseconds. */
export interface TraceStep {
  name: string
  status: StepStatus
  ms: number
  detail: string
  /** Milliseconds from the start of the run to the start of this stage, for the waterfall lane. */
  at?: number
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
