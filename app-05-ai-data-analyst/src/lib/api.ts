import type { QueryPlan } from '../types'

const REQUEST_TIMEOUT_MS = 30_000

interface AskDataRequest {
  question: string
  headers: string[]
  sampleRows: Record<string, string>[]
  rowCount: number
}

/** Thrown when the user cancels an in-flight analysis; the UI stays silent for this one. */
export class CancelledError extends Error {
  constructor() {
    super('Analysis cancelled.')
    this.name = 'CancelledError'
  }
}

export async function askData(
  request: AskDataRequest,
  options: { signal?: AbortSignal } = {},
): Promise<QueryPlan> {
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

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as { error?: string }
      throw new Error(errorBody.error ?? httpFallbackMessage(response.status))
    }

    return (await response.json()) as QueryPlan
  } catch (err) {
    if (options.signal?.aborted) throw new CancelledError()
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('The analysis took too long and was stopped. Try a simpler question.')
    }
    if (err instanceof TypeError) {
      throw new Error('Could not reach the analysis service. Check your connection and try again.')
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
