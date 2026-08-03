import type { ReviewResult, Severity } from '../types'

const REQUEST_TIMEOUT_MS = 45_000
const GENERIC_ERROR = 'The review service is unavailable right now. Please try again.'

const VALID_SEVERITIES: Severity[] = ['critical', 'warning', 'info']

function normalise(raw: unknown): ReviewResult {
  const payload = (raw ?? {}) as {
    comments?: unknown
    lineCount?: unknown
    truncated?: unknown
  }
  const lineCount = typeof payload.lineCount === 'number' ? payload.lineCount : 0
  const comments = (Array.isArray(payload.comments) ? payload.comments : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .filter(
      (c) =>
        typeof c.line === 'number' &&
        typeof c.severity === 'string' &&
        VALID_SEVERITIES.includes(c.severity as Severity) &&
        typeof c.message === 'string' &&
        typeof c.suggestion === 'string',
    )
    .map((c) => ({
      line: c.line as number,
      severity: c.severity as Severity,
      message: c.message as string,
      suggestion: c.suggestion as string,
    }))

  return { comments, lineCount, truncated: payload.truncated === true }
}

/**
 * Posts code for review. Aborts on `signal` (user cancel) or after REQUEST_TIMEOUT_MS,
 * which rejects with a DOMException named TimeoutError.
 */
export async function reviewCode(
  code: string,
  language: string,
  signal?: AbortSignal,
): Promise<ReviewResult> {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    REQUEST_TIMEOUT_MS,
  )
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language }),
      signal: controller.signal,
    })

    const data = (await response.json().catch(() => null)) as {
      success?: boolean
      data?: unknown
      error?: string
    } | null

    if (!response.ok || !data?.success) {
      throw new Error(data?.error ?? GENERIC_ERROR)
    }

    if (!data.data) {
      throw new Error('The review came back empty. Please try again.')
    }

    return normalise(data.data)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
