import { SEVERITIES } from '../constants'
import type { PrFileInput } from '../../netlify/shared/diff'
import type { Decider, PrCounts, ReviewComment, ReviewResult, ReviewRun, RunSummary, Severity, StepStatus, TraceStep, Usage, Verdict } from '../types'

const REQUEST_TIMEOUT_MS = 45_000
const STEP_STATUSES: StepStatus[] = ['ok', 'failed', 'skipped']
const VERDICTS: Verdict[] = ['kept', 'moved', 'dropped', 'unverified']
const DECIDERS: Decider[] = ['verifier', 'check', 'none']
/** A connection that drops sooner than this is retried once; later than this the run budget is spent. */
const RETRY_WITHIN_MS = 12_000

const GENERIC_ERROR = 'The review service is unavailable right now. Please try again.'
const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.'
const TIMEOUT_ERROR = 'The AI provider did not answer in time.'
const CUT_OFF_ERROR = 'The connection dropped before the review finished. Please try again.'
const RATE_LIMITED = 'Rate limited, try again in a minute.'

/** A failed review. `message` is safe to show; `summary` holds whatever trace the run produced. */
export class ReviewError extends Error {
  readonly summary: RunSummary

  constructor(message: string, summary: RunSummary) {
    super(message)
    this.name = 'ReviewError'
    this.summary = summary
  }
}

/** The text to show for a failed review. Only a ReviewError carries a message written for people; anything else gets the generic copy. */
export function reviewErrorMessage(err: unknown): string {
  return err instanceof ReviewError ? err.message : GENERIC_ERROR
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function isWhere(value: unknown): boolean {
  return value === null || (isRecord(value) && typeof value.file === 'string' && isNumber(value.line) && (value.side === 'new' || value.side === 'old'))
}

function isComment(value: unknown): value is ReviewComment {
  return (
    isRecord(value) &&
    isNumber(value.id) &&
    isNumber(value.line) &&
    isNumber(value.fromLine) &&
    SEVERITIES.includes(value.severity as Severity) &&
    typeof value.message === 'string' &&
    typeof value.suggestion === 'string' &&
    VERDICTS.includes(value.verdict as Verdict) &&
    DECIDERS.includes(value.decidedBy as Decider) &&
    typeof value.reason === 'string' &&
    (value.evidence === null || typeof value.evidence === 'string') &&
    typeof value.code === 'string' &&
    isWhere(value.where)
  )
}

function isStep(value: unknown): value is TraceStep {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    STEP_STATUSES.includes(value.status as StepStatus) &&
    isNumber(value.ms) &&
    typeof value.detail === 'string' &&
    (value.at === undefined || isNumber(value.at))
  )
}

function isCounts(value: unknown): value is PrCounts {
  return isRecord(value) && isNumber(value.filesIncluded) && isNumber(value.changedIncluded) && isNumber(value.charsIncluded) && isNumber(value.charLimit)
}

/** The one check on a successful reply. The server already validated every comment; this keeps a malformed reply from reaching the UI. */
function isReviewResult(value: unknown): value is ReviewResult {
  return (
    isRecord(value) &&
    isNumber(value.lineCount) &&
    typeof value.truncated === 'boolean' &&
    typeof value.verified === 'boolean' &&
    isNumber(value.malformed) &&
    (value.mode === 'file' || value.mode === 'pr') &&
    (value.pr === null || isCounts(value.pr)) &&
    Array.isArray(value.comments) &&
    value.comments.every(isComment)
  )
}

/** The trace, usage and timing of a run, or empty values where the reply carried none that could be read. */
function summaryOf(data: unknown): RunSummary {
  const reply = isRecord(data) ? data : {}
  return {
    trace: Array.isArray(reply.trace) && reply.trace.every(isStep) ? reply.trace : [],
    usage: isRecord(reply.usage) && Object.values(reply.usage).every(isNumber) ? (reply.usage as Usage) : null,
    model: typeof reply.model === 'string' ? reply.model : null,
    totalMs: isNumber(reply.totalMs) ? reply.totalMs : 0,
  }
}

/** The server's plain-language error when it sent one, otherwise a message chosen by status. */
function serverMessage(status: number, error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error
  if (status === 429) return RATE_LIMITED
  if (status === 504) return TIMEOUT_ERROR
  return GENERIC_ERROR
}

const attemptStep = (detail: string, startedAt: number, status: StepStatus = 'failed'): TraceStep => ({
  name: 'Send request',
  status,
  ms: Date.now() - startedAt,
  at: 0,
  detail,
})

/**
 * Posts a review request. Rejects with a ReviewError whose message is safe to show. Aborts on `signal` (user cancel)
 * with the abort error; the caller ignores that one. A connection that drops early, or a reply that ends before its JSON
 * does, gets one automatic retry; a rejection, a rate limit, a server error or a timeout never does.
 */
async function postReview(payload: unknown, signal?: AbortSignal): Promise<ReviewRun> {
  const startedAt = Date.now()
  let dropped: TraceStep | null = null

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS)
    const onAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    const attemptAt = Date.now()
    const retryable = () => attempt === 1 && Date.now() - startedAt <= RETRY_WITHIN_MS

    try {
      let response: Response
      let data: unknown
      try {
        response = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        data = await response.json().catch(() => null)
      } catch (err) {
        if (signal?.aborted) throw err
        const totalMs = Date.now() - startedAt
        if ((err as Error)?.name === 'TimeoutError') {
          throw new ReviewError(TIMEOUT_ERROR, withDropped({ trace: [attemptStep('No answer from the server in time', attemptAt)], usage: null, model: null, totalMs }, dropped))
        }
        console.error('CodeLens: review request failed', err)
        if (retryable()) {
          dropped = attemptStep('Could not reach the server. Retried once', attemptAt)
          continue
        }
        throw new ReviewError(NETWORK_ERROR, withDropped({ trace: [attemptStep('Could not reach the server', attemptAt)], usage: null, model: null, totalMs }, dropped))
      }

      // A reply that started and then ended before its JSON did: the connection dropped mid-answer.
      if (data === null && response.ok) {
        if (retryable()) {
          dropped = attemptStep(`The connection dropped before the reply finished (HTTP ${response.status}). Retried once`, attemptAt)
          continue
        }
        throw new ReviewError(CUT_OFF_ERROR, withDropped({ trace: [attemptStep('The reply ended before it finished', attemptAt)], usage: null, model: null, totalMs: Date.now() - startedAt }, dropped))
      }
      if (!response.ok || !isRecord(data) || data.success !== true) {
        const summary = summaryOf(data)
        if (summary.trace.length === 0) summary.trace = [attemptStep(`The server answered HTTP ${response.status} without a trace`, attemptAt)]
        throw new ReviewError(serverMessage(response.status, isRecord(data) ? data.error : undefined), withDropped(summary, dropped))
      }
      if (!isReviewResult(data.result)) throw new ReviewError(GENERIC_ERROR, withDropped(summaryOf(data), dropped))
      return { result: data.result, ...withDropped(summaryOf(data), dropped) }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
  throw new ReviewError(NETWORK_ERROR, { trace: [], usage: null, model: null, totalMs: Date.now() - startedAt })
}

/** Puts the dropped first attempt in front of the server's trace, so a retry is never invisible. */
function withDropped(summary: RunSummary, dropped: TraceStep | null): RunSummary {
  return dropped ? { ...summary, trace: [dropped, ...summary.trace] } : summary
}

/** Posts code for review. */
export function reviewCode(code: string, language: string, signal?: AbortSignal): Promise<ReviewRun> {
  return postReview({ code, language }, signal)
}

/** Posts the chosen files of a pull request for review. Each patch is exactly what GitHub listed. */
export function reviewPullRequest(files: PrFileInput[], signal?: AbortSignal): Promise<ReviewRun> {
  return postReview({ mode: 'pr', files }, signal)
}
