import type { AnalysisResponse, RunStep, RunSummary } from '../types'

const REQUEST_TIMEOUT_MS = 30_000
const UNREADABLE = 'The analysis service returned an unreadable response. Please try again.'

interface AskDataRequest {
  question: string
  headers: string[]
  sampleRows: Record<string, string>[]
  rowCount: number
}

/** Thrown when the user stops an analysis. The UI records it without an error banner. */
export class CancelledError extends Error {
  constructor() {
    super('Analysis cancelled.')
    this.name = 'CancelledError'
  }
}

/** Thrown when an analysis fails. Carries the steps that ran, so the UI can show where it stopped. */
export class AnalysisRunError extends Error {
  readonly run: RunSummary

  constructor(message: string, run: RunSummary) {
    super(message)
    this.name = 'AnalysisRunError'
    this.run = run
  }
}

/** A run that never got a server trace gets a single client-side step. */
export function clientRun(detail: string, startedAt: number, status: RunStep['status'] = 'failed'): RunSummary {
  const elapsed = Date.now() - startedAt
  return {
    trace: [{ name: 'Send request', status, ms: elapsed, detail }],
    usage: {},
    model: null,
    totalMs: elapsed,
  }
}

function isRun(value: unknown): value is RunSummary {
  return typeof value === 'object' && value !== null && Array.isArray((value as RunSummary).trace)
}

function isAnalysisResponse(value: unknown): value is AnalysisResponse {
  return isRun(value) && typeof (value as AnalysisResponse).result === 'object' && (value as AnalysisResponse).result !== null
}

export async function askData(
  request: AskDataRequest,
  options: { signal?: AbortSignal } = {},
): Promise<AnalysisResponse> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const onExternalAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onExternalAbort)

  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    })

    let body: unknown = null
    try {
      body = await response.json()
    } catch (err) {
      // A body that is not JSON is handled below. Aborts and network errors still propagate.
      if (!(err instanceof SyntaxError)) throw err
    }

    if (!response.ok) {
      const message = (body as { error?: string } | null)?.error ?? httpFallbackMessage(response.status)
      throw new AnalysisRunError(message, isRun(body) ? body : clientRun(message, startedAt))
    }
    if (!isAnalysisResponse(body)) {
      throw new AnalysisRunError(UNREADABLE, clientRun(UNREADABLE, startedAt))
    }
    return body
  } catch (err) {
    if (err instanceof AnalysisRunError) throw err
    if (options.signal?.aborted) throw new CancelledError()
    if (err instanceof Error && err.name === 'AbortError') {
      const message = 'The analysis took too long and was stopped. Try a simpler question.'
      throw new AnalysisRunError(message, clientRun('No complete reply came back in time.', startedAt))
    }
    if (err instanceof TypeError) {
      const message = 'Could not reach the analysis service. Check your connection and try again.'
      throw new AnalysisRunError(message, clientRun('The request did not reach the server.', startedAt))
    }
    throw err
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
}

function httpFallbackMessage(status: number): string {
  if (status === 429) return 'Too many requests right now. Please wait a moment and try again.'
  if (status === 413) return 'That dataset is too large to analyze.'
  if (status >= 500) return 'The analysis service is unavailable right now. Please try again.'
  return 'The analysis request was rejected. Try rephrasing your question.'
}
