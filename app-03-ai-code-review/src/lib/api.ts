import type { ReviewComment, ReviewRun, RunSummary, Severity, StepStatus, TraceStep, Usage } from '../types'

const REQUEST_TIMEOUT_MS = 45_000
const SEVERITIES: Severity[] = ['critical', 'warning', 'info']
const STEP_STATUSES: StepStatus[] = ['ok', 'failed', 'skipped']
const USAGE_FIELDS = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const

export const GENERIC_ERROR = 'The review service is unavailable right now. Please try again.'
export const NETWORK_ERROR = 'Could not reach the review service. Check your connection and try again.'
export const TIMEOUT_ERROR = 'The review took too long to come back. Try a shorter snippet.'

/** A failed review. `message` is safe to show; `summary` holds whatever trace the run produced. */
export class ReviewError extends Error {
  readonly summary: RunSummary

  constructor(message: string, summary: RunSummary) {
    super(message)
    this.name = 'ReviewError'
    this.summary = summary
  }
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normaliseTrace(raw: unknown): TraceStep[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item: unknown): TraceStep[] => {
    if (!item || typeof item !== 'object') return []
    const step = item as Record<string, unknown>
    if (typeof step.name !== 'string' || !STEP_STATUSES.includes(step.status as StepStatus)) return []
    return [
      {
        name: step.name,
        status: step.status as StepStatus,
        ms: finite(step.ms),
        detail: typeof step.detail === 'string' ? step.detail : '',
        ...(typeof step.tokens === 'number' ? { tokens: step.tokens } : {}),
        ...(typeof step.cost === 'number' ? { cost: step.cost } : {}),
      },
    ]
  })
}

function normaliseUsage(raw: unknown): Usage | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const usage: Usage = {}
  for (const field of USAGE_FIELDS) {
    const value = source[field]
    if (typeof value === 'number') usage[field] = value
  }
  return Object.keys(usage).length > 0 ? usage : null
}

function toComment(item: unknown): ReviewComment[] {
  if (!item || typeof item !== 'object') return []
  const c = item as Record<string, unknown>
  const valid =
    typeof c.line === 'number' &&
    typeof c.message === 'string' &&
    typeof c.suggestion === 'string' &&
    SEVERITIES.includes(c.severity as Severity)
  if (!valid) return []
  return [
    {
      line: c.line as number,
      severity: c.severity as Severity,
      message: c.message as string,
      suggestion: c.suggestion as string,
    },
  ]
}

function normaliseRun(raw: unknown): ReviewRun {
  const payload = (raw ?? {}) as Record<string, unknown>
  const result = (payload.result ?? {}) as Record<string, unknown>
  return {
    result: {
      comments: Array.isArray(result.comments) ? result.comments.flatMap(toComment) : [],
      lineCount: finite(result.lineCount),
      truncated: result.truncated === true,
    },
    trace: normaliseTrace(payload.trace),
    usage: normaliseUsage(payload.usage),
    model: typeof payload.model === 'string' ? payload.model : null,
    totalMs: finite(payload.totalMs),
  }
}

function clientStep(detail: string, startedAt: number): TraceStep {
  return { name: 'Send request', status: 'failed', ms: Date.now() - startedAt, detail }
}

/** The server's plain-language error when it sent one, otherwise a message chosen by status. */
function serverMessage(status: number, error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error
  if (status === 429) return 'The AI service is busy right now. Please try again in a moment.'
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

    const data = (await response.json().catch(() => null)) as { success?: boolean; error?: unknown } | null
    const run = normaliseRun(data)
    if (!response.ok || !data?.success) {
      throw new ReviewError(serverMessage(response.status, data?.error), {
        trace: run.trace,
        usage: run.usage,
        model: run.model,
        totalMs: run.totalMs,
      })
    }
    return run
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
