import type { SummaryStats } from './mockData'
import { isAuthNetworkError } from './supabase'

const INSIGHTS_ENDPOINT = '/api/ai'
const SSE_PREFIX = 'data: '
const SSE_TERMINATOR = '[DONE]'

let activeController: AbortController | null = null

/** One stage of a run, timed on the server. */
export interface TraceStep {
  name: string
  status: 'ok' | 'failed' | 'skipped'
  ms: number
  detail: string
  tokens?: number
  cost?: number
}

/** Token and cost figures as the provider reported them. A missing field was not reported. */
export interface RunUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost?: number
}

export interface RunOutcome {
  result: string
  trace: TraceStep[]
  usage: RunUsage | null
  model: string | null
  totalMs: number
}

export interface RunHandlers {
  onStage: (stage: string) => void
  onStep: (step: TraceStep) => void
  onText: (text: string) => void
  onComplete: (outcome: RunOutcome) => void
}

/** A run that failed. The message is plain language and safe to show as it is. */
export class RunError extends Error {
  readonly totalMs: number | null

  constructor(message: string, totalMs: number | null = null) {
    super(message)
    this.name = 'RunError'
    this.totalMs = totalMs
  }
}

interface Frame extends Partial<RunOutcome> {
  stage?: string
  step?: TraceStep
  text?: string
  error?: string
}

/** Cancel the in-flight insights stream, if any. Safe to call when nothing is running. */
export function abortInsights(): void {
  activeController?.abort()
  activeController = null
}

/** True when a rejection came from abortInsights() rather than a real failure. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/**
 * Handle one SSE line. Returns true once the terminator is seen.
 * Malformed JSON is a truncated frame, not a failure: skip it and keep reading.
 */
function consumeSseLine(line: string, handlers: RunHandlers): boolean {
  if (!line.startsWith(SSE_PREFIX)) return false

  const data = line.slice(SSE_PREFIX.length).trim()
  if (data === SSE_TERMINATOR) return true

  let frame: Frame
  try {
    frame = JSON.parse(data) as Frame
  } catch (e) {
    if (e instanceof SyntaxError) return false
    throw e
  }

  if (frame.error) throw new RunError(frame.error, frame.totalMs ?? null)
  if (frame.step) handlers.onStep(frame.step)
  if (frame.text) handlers.onText(frame.text)
  if (frame.stage === 'complete') {
    handlers.onComplete({
      result: frame.result ?? '',
      trace: frame.trace ?? [],
      usage: frame.usage ?? null,
      model: frame.model ?? null,
      totalMs: frame.totalMs ?? 0,
    })
  } else if (frame.stage) {
    handlers.onStage(frame.stage)
  }
  return false
}

/** Maps an HTTP failure status to copy a user can act on. */
function messageForStatus(status: number): string {
  if (status === 429) return 'Too many requests. Try again in a minute.'
  if (status >= 500) return 'The insights service is temporarily unavailable. Please try again.'
  return 'The insights request could not be completed. Please try again.'
}

export async function getInsights(metrics: SummaryStats, handlers: RunHandlers): Promise<void> {
  // Cancel any in-flight request before starting a new one
  abortInsights()

  const controller = new AbortController()
  activeController = controller

  try {
    let response: Response
    try {
      response = await fetch(INSIGHTS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metrics }),
        signal: controller.signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      if (isAuthNetworkError(err)) {
        console.error('getInsights: network error', err)
        throw new RunError("Couldn't reach the insights service. Check your connection and try again.")
      }
      throw err
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error(`getInsights: upstream ${response.status}`, text)
      throw new RunError(messageForStatus(response.status))
    }

    if (!response.body) {
      throw new RunError('The insights service returned no response. Please try again.')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (consumeSseLine(line.trim(), handlers)) return
        }
      }

      // Process any trailing frame left in the buffer
      if (buffer.trim()) consumeSseLine(buffer.trim(), handlers)
    } finally {
      await reader.cancel().catch(() => {})
    }
  } finally {
    if (activeController === controller) {
      activeController = null
    }
  }
}
