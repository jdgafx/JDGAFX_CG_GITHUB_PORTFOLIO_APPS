import { SEVERITIES } from '../constants'
import type { ReviewComment, ReviewResult, ReviewRun, RunSummary, Severity, StepStatus, TraceStep, Usage } from '../types'

const REQUEST_TIMEOUT_MS = 45_000
const STEP_STATUSES: StepStatus[] = ['ok', 'failed', 'skipped']

const GENERIC_ERROR = 'The review service is unavailable right now. Please try again.'
const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.'
const TIMEOUT_ERROR = 'The AI provider did not answer in time.'
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

function isComment(value: unknown): value is ReviewComment {
  return (
    isRecord(value) &&
    isNumber(value.line) &&
    SEVERITIES.includes(value.severity as Severity) &&
    typeof value.message === 'string' &&
    typeof value.suggestion === 'string'
  )
}

function isStep(value: unknown): value is TraceStep {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    STEP_STATUSES.includes(value.status as StepStatus) &&
    isNumber(value.ms) &&
    typeof value.detail === 'string'
  )
}

/** The one check on a successful reply. The server already validated every comment; this keeps a malformed reply from reaching the UI. */
function isReviewResult(value: unknown): value is ReviewResult {
  return (
    isRecord(value) &&
    isNumber(value.lineCount) &&
    typeof value.truncated === 'boolean' &&
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

function clientStep(detail: string, startedAt: number): TraceStep {
  return { name: 'Send request', status: 'failed', ms: Date.now() - startedAt, detail }
}

/** The server's plain-language error when it sent one, otherwise a message chosen by status. */
function serverMessage(status: number, error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error
  if (status === 429) return RATE_LIMITED
  if (status === 504) return TIMEOUT_ERROR
  return GENERIC_ERROR
}

/**
 * Posts code for review. Rejects with a ReviewError whose message is safe to show.
 * Aborts on `signal` (user cancel) with the abort error; the caller ignores that one.
 */
export async function reviewCode(code: string, language: string, signal?: AbortSignal): Promise<ReviewRun> {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    REQUEST_TIMEOUT_MS,
  )
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const startedAt = Date.now()

  try {
    let response: Response
    try {
      response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, language }),
        signal: controller.signal,
      })
    } catch (err) {
      if (signal?.aborted) throw err
      const totalMs = Date.now() - startedAt
      if ((err as Error)?.name === 'TimeoutError') {
        throw new ReviewError(TIMEOUT_ERROR, {
          trace: [clientStep('No answer from the server in time', startedAt)],
          usage: null,
          model: null,
          totalMs,
        })
      }
      console.error('CodeLens: review request failed', err)
      throw new ReviewError(NETWORK_ERROR, {
        trace: [clientStep('Could not reach the server', startedAt)],
        usage: null,
        model: null,
        totalMs,
      })
    }

    const data: unknown = await response.json().catch(() => null)
    if (!response.ok || !isRecord(data) || data.success !== true) {
      throw new ReviewError(serverMessage(response.status, isRecord(data) ? data.error : undefined), summaryOf(data))
    }
    if (!isReviewResult(data.result)) throw new ReviewError(GENERIC_ERROR, summaryOf(data))
    return { result: data.result, ...summaryOf(data) }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
