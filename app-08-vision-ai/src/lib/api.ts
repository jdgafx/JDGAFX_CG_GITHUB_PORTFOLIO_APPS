import { isRecord } from './guards'
import { fileProblem, parseDataUrl, type DataUrlParts } from './image'

export type AnalysisMode = 'describe' | 'analyze' | 'qa' | 'extract'
const STEP_STATUSES = ['running', 'ok', 'failed', 'skipped'] as const
export type StepStatus = (typeof STEP_STATUSES)[number]

export interface TraceStep {
  name: string
  status: StepStatus
  ms?: number
  detail: string
  tokens?: number
  cost?: number
}

interface RunUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost?: number
}

export interface RunSummary {
  trace: TraceStep[]
  usage: RunUsage | null
  model: string | null
  totalMs: number
}

type RunOutcome =
  | { status: 'complete'; result: string; summary: RunSummary }
  | { status: 'failed'; message: string; truncated: boolean; summary: RunSummary }
  | { status: 'cancelled'; summary: RunSummary }

interface AnalyzeOptions {
  file: File
  mode: AnalysisMode
  question?: string
  signal?: AbortSignal
  onStep: (step: TraceStep) => void
  onText: (text: string) => void
}

// Longest question the server accepts. The question input enforces the same limit.
export const MAX_QUESTION_CHARS = 1000

// The server stops every provider call at 25 seconds and always sends a final frame,
// so this limit only guards a connection that stalls.
const REQUEST_TIMEOUT_MS = 60_000
const TIMED_OUT_MESSAGE = 'The AI provider did not answer in time.'
const TIMED_OUT_DETAIL = 'No answer within 60 seconds'
const STOPPED_DETAIL = 'Stopped by you before it finished'
const DROPPED_MESSAGE = 'The connection dropped before the analysis finished. The result above may be incomplete.'
const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.'
const UNREADABLE_MESSAGE = 'This image could not be read in the browser. Try another file.'
const NO_RESULT_MESSAGE = 'The vision service returned no usable analysis. Please retry with the same image.'

function fileToBase64(file: File): Promise<DataUrlParts> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const parts = typeof reader.result === 'string' ? parseDataUrl(reader.result) : null
      if (parts) resolve(parts)
      else reject(new Error('Malformed data URL'))
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

// Replaces the step with the same name, or appends it. Used for the live trace and the history view alike.
export function upsertStep(steps: TraceStep[], step: TraceStep): TraceStep[] {
  const index = steps.findIndex(existing => existing.name === step.name)
  if (index === -1) return [...steps, step]
  const next = steps.slice()
  next[index] = step
  return next
}

// The steps of one run, reported as each changes so the trace updates live.
// Running steps are timed from the moment they were first reported.
interface Trace {
  steps: TraceStep[]
  readonly startedAt: number
  readonly since: Map<string, number>
  readonly onStep: (step: TraceStep) => void
}

function newTrace(onStep: (step: TraceStep) => void): Trace {
  return { steps: [], startedAt: Date.now(), since: new Map(), onStep }
}

function record(trace: Trace, step: TraceStep): void {
  if (step.status === 'running') trace.since.set(step.name, Date.now())
  trace.steps = upsertStep(trace.steps, step)
  trace.onStep(step)
}

function elapsed(trace: Trace, name: string): number {
  return Date.now() - (trace.since.get(name) ?? trace.startedAt)
}

function localSummary(trace: Trace): RunSummary {
  return { trace: trace.steps, usage: null, model: null, totalMs: Date.now() - trace.startedAt }
}

// Ends every step still running, so a stopped run never shows a step in progress.
function settle(trace: Trace, detail: string): void {
  for (const step of trace.steps.filter(s => s.status === 'running')) {
    record(trace, { name: step.name, status: 'failed', ms: elapsed(trace, step.name), detail })
  }
}

function fail(trace: Trace, name: string, detail: string, message: string): RunOutcome {
  record(trace, { name, status: 'failed', ms: elapsed(trace, name), detail })
  return { status: 'failed', message, truncated: false, summary: localSummary(trace) }
}

function activeName(trace: Trace): string {
  return trace.steps.find(step => step.status === 'running')?.name ?? 'Request checked'
}

export async function analyzeImage(opts: AnalyzeOptions): Promise<RunOutcome> {
  const trace = newTrace(opts.onStep)
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  const stopFromCaller = () => controller.abort()
  if (opts.signal?.aborted) controller.abort()
  opts.signal?.addEventListener('abort', stopFromCaller)

  try {
    return await runRequest(opts, trace, controller.signal)
  } catch (err) {
    if (!isAbortError(err)) {
      const message = 'The analysis stopped unexpectedly. Please try again.'
      return fail(trace, activeName(trace), message, message)
    }
    if (timedOut) {
      settle(trace, TIMED_OUT_DETAIL)
      return { status: 'failed', message: TIMED_OUT_MESSAGE, truncated: false, summary: localSummary(trace) }
    }
    settle(trace, STOPPED_DETAIL)
    return { status: 'cancelled', summary: localSummary(trace) }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', stopFromCaller)
  }
}

async function runRequest(opts: AnalyzeOptions, trace: Trace, signal: AbortSignal): Promise<RunOutcome> {
  const problem = fileProblem(opts.file)
  if (problem) return fail(trace, 'Request checked', problem, problem)

  let encoded: DataUrlParts
  try {
    encoded = await fileToBase64(opts.file)
  } catch {
    return fail(trace, 'Request checked', UNREADABLE_MESSAGE, UNREADABLE_MESSAGE)
  }

  let response: Response
  try {
    response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        image: encoded.data,
        mediaType: encoded.mediaType,
        mode: opts.mode,
        question: opts.mode === 'qa' ? opts.question : undefined,
      }),
    })
  } catch (err) {
    if (isAbortError(err)) throw err
    return fail(trace, 'Request checked', NETWORK_MESSAGE, NETWORK_MESSAGE)
  }

  if (!response.ok) return rejectedRequest(response, trace)
  if (!response.body) return fail(trace, 'Request checked', NO_RESULT_MESSAGE, NO_RESULT_MESSAGE)
  return readStream(response.body, opts, trace)
}

// The server answers before streaming starts with a JSON error. When it includes
// a trace, the failed step is shown exactly as the server recorded it.
async function rejectedRequest(response: Response, trace: Trace): Promise<RunOutcome> {
  const body: unknown = await response.json().catch(() => null)
  const fields: Record<string, unknown> = isRecord(body) ? body : {}
  const message =
    typeof fields.error === 'string' && fields.error
      ? fields.error
      : `The analysis could not start (HTTP ${response.status}). Please try again.`
  const steps = fields.trace
  if (!Array.isArray(steps)) return fail(trace, 'Request checked', message, message)
  for (const step of steps.filter(isTraceStep)) record(trace, step)
  return { status: 'failed', message, truncated: false, summary: localSummary(trace) }
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  opts: AnalyzeOptions,
  trace: Trace,
): Promise<RunOutcome> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (err) {
        // A socket that dies mid-stream throws a bare network error; say what happened instead.
        if (isAbortError(err)) throw err
        return fail(trace, 'Model call', DROPPED_MESSAGE, DROPPED_MESSAGE)
      }
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const finished = handleLine(line, opts, trace)
        if (finished) return finished
      }
    }
    buffer += decoder.decode()
    // No terminal frame means the connection dropped mid-analysis: never treat a partial answer as complete.
    return handleLine(buffer, opts, trace) ?? fail(trace, 'Model call', DROPPED_MESSAGE, DROPPED_MESSAGE)
  } finally {
    void reader.cancel().catch(() => undefined)
  }
}

// Returns the outcome when the line is the terminal frame, otherwise null.
function handleLine(line: string, opts: AnalyzeOptions, trace: Trace): RunOutcome | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const frame = parsed

  if (frame.stage === 'step' && isTraceStep(frame.step)) {
    record(trace, frame.step)
    return null
  }
  if (typeof frame.text === 'string') {
    opts.onText(frame.text)
    return null
  }
  if (frame.stage === 'complete') {
    const result = typeof frame.result === 'string' ? frame.result : ''
    const summary = summaryFrom(frame, trace)
    return result.trim()
      ? { status: 'complete', result, summary }
      : { status: 'failed', message: NO_RESULT_MESSAGE, truncated: false, summary }
  }
  if (frame.stage === 'failed') {
    return {
      status: 'failed',
      message: typeof frame.error === 'string' && frame.error ? frame.error : NO_RESULT_MESSAGE,
      truncated: frame.truncated === true,
      summary: summaryFrom(frame, trace),
    }
  }
  return null
}

function summaryFrom(frame: Record<string, unknown>, trace: Trace): RunSummary {
  return {
    trace: Array.isArray(frame.trace) ? frame.trace.filter(isTraceStep) : trace.steps,
    usage: isRecord(frame.usage) ? (frame.usage as RunUsage) : null,
    model: typeof frame.model === 'string' ? frame.model : null,
    totalMs: typeof frame.totalMs === 'number' ? frame.totalMs : localSummary(trace).totalMs,
  }
}

function isTraceStep(value: unknown): value is TraceStep {
  if (!isRecord(value)) return false
  return (
    typeof value.name === 'string' &&
    typeof value.detail === 'string' &&
    typeof value.status === 'string' &&
    (STEP_STATUSES as readonly string[]).includes(value.status)
  )
}

function isAbortError(err: unknown): boolean {
  return isRecord(err) && err.name === 'AbortError'
}
