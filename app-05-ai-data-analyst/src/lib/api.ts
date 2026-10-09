import type { AnalysisResponse, ParsedData, RunStep, RunSummary } from '../types'
import { MAX_CELL_CHARS, MAX_SAMPLE_ROWS } from './limits'

const REQUEST_TIMEOUT_MS = 30_000
const UNREADABLE = 'The analysis service returned an unreadable response. Please try again.'
const UNREACHABLE = 'Could not reach the server. Check your connection and try again.'
const TIMED_OUT = 'The analysis service did not answer in time. Try again.'
const UNEXPECTED = 'The analysis could not be completed. Please try again.'

interface AskDataRequest {
  question: string
  headers: string[]
  sampleRows: Record<string, string>[]
  rowCount: number
}

/** The sample sent to the model: the first rows, each cell cut to the server's limit. */
export function sampleFor(data: ParsedData): Record<string, string>[] {
  return data.rows.slice(0, MAX_SAMPLE_ROWS).map((row) => {
    const out: Record<string, string> = {}
    for (const header of data.headers) {
      const cell = row[header]
      if (cell !== undefined) out[header] = cell.slice(0, MAX_CELL_CHARS)
    }
    return out
  })
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

function isStep(value: unknown): value is RunStep {
  if (typeof value !== 'object' || value === null) return false
  const step = value as Partial<Record<keyof RunStep, unknown>>
  return (
    typeof step.name === 'string' &&
    typeof step.detail === 'string' &&
    typeof step.ms === 'number' &&
    (step.status === 'ok' || step.status === 'failed' || step.status === 'skipped')
  )
}

/** A run the page can render: steps, a measured total and a usage object, all present. */
function isRun(value: unknown): value is RunSummary {
  if (typeof value !== 'object' || value === null) return false
  const run = value as Partial<Record<keyof RunSummary, unknown>>
  return (
    Array.isArray(run.trace) &&
    run.trace.every(isStep) &&
    typeof run.totalMs === 'number' &&
    typeof run.usage === 'object' &&
    run.usage !== null
  )
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
      throw new AnalysisRunError(TIMED_OUT, clientRun('No complete reply came back in time.', startedAt))
    }
    if (err instanceof TypeError) {
      throw new AnalysisRunError(UNREACHABLE, clientRun('The request did not reach the server.', startedAt))
    }
    throw new AnalysisRunError(UNEXPECTED, clientRun('The request failed in the browser.', startedAt))
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
}

function httpFallbackMessage(status: number): string {
  if (status === 429) return 'Rate limited, try again in a minute.'
  if (status === 413) return 'That dataset is too large to analyze.'
  if (status === 504) return 'The AI provider did not answer in time.'
  if (status >= 500) return 'The analysis service is unavailable right now. Please try again.'
  return 'The analysis request was rejected. Try rephrasing your question.'
}
