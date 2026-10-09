import type { Summary } from '../../netlify/shared/contract'

const INSIGHTS_ENDPOINT = '/api/ai'
const SSE_PREFIX = 'data: '
const SSE_TERMINATOR = '[DONE]'
/** The browser gives up when no byte has arrived for this long. A healthy run sends a frame every few seconds. */
const IDLE_TIMEOUT_MS = 30_000
/** Backstop for a stream that trickles bytes but never closes: the server's 25-second budget plus a generous margin. */
const OVERALL_TIMEOUT_MS = 60_000
const NETWORK_MESSAGE = "Couldn't reach the insights service. Check your connection and try again."
const TIMEOUT_MESSAGE = 'The insights service did not answer in time. Try again.'
const IDLE_MESSAGE = 'The insights service went quiet for 30 seconds, so the run was ended. Try again.'
const GENERIC_MESSAGE = 'The insights request could not be completed. Please try again.'

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

/** The five stages the server runs, in order, each with what it does in plain words. */
export const TRACE_STAGES: ReadonlyArray<{ name: string; does: string }> = [
  { name: 'Build request', does: 'Builds the prompt from the summary figures.' },
  { name: 'Call model', does: 'Sends one chat request to the model, with a fixed output limit.' },
  { name: 'Stream answer', does: 'Passes each piece of the answer to this page as it arrives.' },
  { name: 'Check figures', does: 'Matches each percentage and download count to the summary.' },
  { name: 'Validate output', does: 'Fails an empty answer, or one cut off before it finished.' },
]

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
  stage?: 'complete'
  step?: TraceStep
  text?: string
  error?: string
}

/** Cancel the in-flight insights stream, if any. Safe to call when nothing is running. */
export function abortInsights(): void {
  activeController?.abort()
  activeController = null
}

/** True when a rejection came from an abort (a Stop, a new run or the client deadline), not from a server failure. */
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
    frame = (JSON.parse(data) as Frame | null) ?? {}
  } catch {
    return false
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
  }
  return false
}

/** Maps an HTTP failure status to copy a user can act on. */
function messageForStatus(status: number): string {
  if (status === 429) return 'Too many requests. Try again in a minute.'
  if (status >= 500) return 'The insights service is temporarily unavailable. Please try again.'
  return GENERIC_MESSAGE
}

async function send(summary: Summary, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(INSIGHTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary }),
      signal,
    })
  } catch (err) {
    if (isAbortError(err)) throw err
    // fetch rejects only when the request never reached the server
    throw new RunError(NETWORK_MESSAGE)
  }
}

async function readStream(body: ReadableStream<Uint8Array>, handlers: RunHandlers, onBytes: () => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      onBytes()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (consumeSseLine(line.trim(), handlers)) return
      }
    }
    // Process any trailing frame left in the buffer
    if (buffer.trim()) consumeSseLine(buffer.trim(), handlers)
  } catch (err) {
    if (isAbortError(err) || err instanceof RunError) throw err
    throw new RunError(NETWORK_MESSAGE)
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/**
 * Posts the summary figures and streams the answer to the handlers. Resolves when the stream ends.
 * Rejects with a RunError (plain words) or an AbortError (the viewer stopped the run).
 */
export async function getInsights(summary: Summary, handlers: RunHandlers): Promise<void> {
  // Cancel any in-flight request before starting a new one
  abortInsights()

  const controller = new AbortController()
  activeController = controller
  // Two watchdogs: one that restarts on every byte, and one cap on the whole run. A viewer's Stop sets neither.
  let timedOut: string | null = null
  const expire = (message: string) => () => {
    timedOut = message
    controller.abort()
  }
  let idle = setTimeout(expire(IDLE_MESSAGE), IDLE_TIMEOUT_MS)
  const overall = setTimeout(expire(TIMEOUT_MESSAGE), OVERALL_TIMEOUT_MS)
  const onBytes = () => {
    clearTimeout(idle)
    idle = setTimeout(expire(IDLE_MESSAGE), IDLE_TIMEOUT_MS)
  }

  try {
    const response = await send(summary, controller.signal)
    if (!response.ok) throw new RunError(messageForStatus(response.status))
    if (!response.body) throw new RunError('The insights service returned no response. Please try again.')
    await readStream(response.body, handlers, onBytes)
  } catch (err) {
    if (timedOut !== null && isAbortError(err)) throw new RunError(timedOut)
    throw err
  } finally {
    clearTimeout(idle)
    clearTimeout(overall)
    if (activeController === controller) activeController = null
  }
}
