// One request to a function: its retry, its limit, its error and the shape check every reply passes. api.ts builds a review from these.
import { SEVERITIES } from '../constants'
import type { Decider, ModelCheck, PrCounts, ReviewComment, ReviewResult, RunSummary, ServedCall, Severity, StepStatus, TraceStep, Usage, Verdict } from '../types'

/** One request's limit. The platform cuts a function at 26 s (netlify/shared/budget.ts), so a request still open at 30 s is lost. */
const REQUEST_TIMEOUT_MS = 30_000
const STEP_STATUSES: StepStatus[] = ['ok', 'failed', 'skipped']
export const VERDICTS: Verdict[] = ['kept', 'moved', 'dropped', 'unverified']
export const DECIDERS: Decider[] = ['verifier', 'check', 'none']
export const MODEL_CHECKS: ModelCheck[] = ['match', 'mismatch', 'unchecked', 'not-reported']
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

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
    (value.support === null || typeof value.support === 'string') &&
    (value.supportLine === null || isNumber(value.supportLine)) &&
    (value.claimKind === undefined || value.claimKind === null || typeof value.claimKind === 'string') &&
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

function isServedCall(value: unknown): value is ServedCall {
  return isRecord(value) && typeof value.pass === 'string' && (value.model === null || typeof value.model === 'string')
}

function isCounts(value: unknown): value is PrCounts {
  return isRecord(value) && isNumber(value.filesIncluded) && isNumber(value.changedIncluded) && isNumber(value.charsIncluded) && isNumber(value.charLimit)
}

/** The one check on a successful reply. The server already validated every comment; this keeps a malformed reply from reaching the UI. */
export function isReviewResult(value: unknown): value is ReviewResult {
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
    newestModel: typeof reply.newestModel === 'string' ? reply.newestModel : null,
    modelCheck: MODEL_CHECKS.includes(reply.modelCheck as ModelCheck) ? (reply.modelCheck as ModelCheck) : 'not-reported',
    servedModels: Array.isArray(reply.servedModels) && reply.servedModels.every(isServedCall) ? reply.servedModels : [],
    totalMs: isNumber(reply.totalMs) ? reply.totalMs : 0,
    // The server counts the calls it could not account for. An answer that is not the server's JSON (a platform cut-off page)
    // leaves the call that was running unknown.
    unreportedCalls: isNumber(reply.unreportedCalls) ? reply.unreportedCalls : isRecord(data) ? 0 : 1,
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
 * Posts one request of a review. `accept` reads the successful reply and returns null for one that is not the shape that
 * request promises. Rejects with a ReviewError whose message is safe to show. Aborts on `signal` (user cancel) with the abort
 * error; the caller ignores that one. A connection that drops early, or a reply that ends before its JSON does, gets one
 * automatic retry; a rejection, a rate limit, a server error or a timeout never does.
 */
export async function postStage<T>(path: string, payload: unknown, signal: AbortSignal | undefined, accept: (data: Record<string, unknown>) => T | null): Promise<{ value: T } & RunSummary> {
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
        response = await fetch(path, {
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
          throw new ReviewError(TIMEOUT_ERROR, withDropped({ trace: [attemptStep('No answer from the server in time', attemptAt)], usage: null, model: null, newestModel: null, modelCheck: 'not-reported', servedModels: [], unreportedCalls: 1, totalMs }, dropped))
        }
        if (retryable()) {
          dropped = attemptStep('Could not reach the server. Retried once', attemptAt)
          continue
        }
        // Logged only when the last try fails: a dropped connection that the retry recovers is not an error.
        console.error('CodeLens: review request failed', err)
        throw new ReviewError(NETWORK_ERROR, withDropped({ trace: [attemptStep('Could not reach the server', attemptAt)], usage: null, model: null, newestModel: null, modelCheck: 'not-reported', servedModels: [], unreportedCalls: 1, totalMs }, dropped))
      }

      // A reply that started and then ended before its JSON did: the connection dropped mid-answer.
      if (data === null && response.ok) {
        if (retryable()) {
          dropped = attemptStep(`The connection dropped before the reply finished (HTTP ${response.status}). Retried once`, attemptAt)
          continue
        }
        throw new ReviewError(CUT_OFF_ERROR, withDropped({ trace: [attemptStep('The reply ended before it finished', attemptAt)], usage: null, model: null, newestModel: null, modelCheck: 'not-reported', servedModels: [], unreportedCalls: 1, totalMs: Date.now() - startedAt }, dropped))
      }
      if (!response.ok || !isRecord(data) || data.success !== true) {
        const summary = summaryOf(data)
        if (summary.trace.length === 0) summary.trace = [attemptStep(`The server answered HTTP ${response.status} without a trace`, attemptAt)]
        throw new ReviewError(serverMessage(response.status, isRecord(data) ? data.error : undefined), withDropped(summary, dropped))
      }
      const value = accept(data)
      if (value === null) throw new ReviewError(GENERIC_ERROR, withDropped(summaryOf(data), dropped))
      return { value, ...withDropped(summaryOf(data), dropped) }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
  throw new ReviewError(NETWORK_ERROR, { trace: [], usage: null, model: null, newestModel: null, modelCheck: 'not-reported', servedModels: [], unreportedCalls: 1, totalMs: Date.now() - startedAt })
}

/** Puts the dropped first attempt in front of the server's trace, so a retry is never invisible. */
function withDropped(summary: RunSummary, dropped: TraceStep | null): RunSummary {
  // A connection that was lost may have reached the server and run a call: it is one the totals cannot account for.
  return dropped ? { ...summary, trace: [dropped, ...summary.trace], unreportedCalls: summary.unreportedCalls + 1 } : summary
}
