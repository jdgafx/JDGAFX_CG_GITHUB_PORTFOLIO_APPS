import { fileProblem, parseDataUrl, type DataUrlParts } from './image'

export type AnalysisMode = 'describe' | 'analyze' | 'qa' | 'extract'
export type StepStatus = 'running' | 'ok' | 'failed' | 'skipped'

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
const STEP_STATUSES: readonly string[] = ['running', 'ok', 'failed', 'skipped']
const TIMED_OUT_MESSAGE = 'The AI provider did not answer in time.'
const TIMED_OUT_DETAIL = 'No answer within 60 seconds'
const STOPPED_DETAIL = 'Stopped by you before it finished'
const DROPPED_MESSAGE = 'The connection dropped before the analysis finished. The result above may be incomplete.'
const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.'
const UNREADABLE_MESSAGE = 'This image could not be read in the browser. Try another file.'
const NO_RESULT_MESSAGE = 'The vision service returned no usable analysis. Please retry with the same image.'

interface StreamFrame {
  stage?: unknown
  step?: unknown
  text?: unknown
  result?: unknown
  error?: unknown
  truncated?: unknown
  trace?: unknown
  usage?: unknown
  model?: unknown
  totalMs?: unknown
}

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

// Keeps the steps of one run and reports each change, so the trace updates live.
// Running steps are timed from the moment they were first reported.
class TraceRecorder {
  readonly steps: TraceStep[] = []
  private readonly startedAt = Date.now()
  private readonly since = new Map<string, number>()
  private readonly onStep: (step: TraceStep) => void

  constructor(onStep: (step: TraceStep) => void) {
    this.onStep = onStep
  }

  record(step: TraceStep): void {
    if (step.status === 'running') this.since.set(step.name, Date.now())
    const index = this.steps.findIndex(existing => existing.name === step.name)
    if (index === -1) this.steps.push(step)
    else this.steps[index] = step
    this.onStep(step)
  }

  // Ends every step still running, so a stopped run never shows a step in progress.
  settle(detail: string): void {
    for (const step of this.steps.filter(s => s.status === 'running')) {
      this.record({ name: step.name, status: 'failed', ms: this.elapsed(step.name), detail })
    }
  }

  fail(name: string, detail: string, message: string): RunOutcome {
    this.record({ name, status: 'failed', ms: this.elapsed(name), detail })
    return { status: 'failed', message, truncated: false, summary: this.localSummary() }
  }

  activeName(): string {
    return this.steps.find(step => step.status === 'running')?.name ?? 'Request checked'
  }

  localSummary(): RunSummary {
    return { trace: this.steps.slice(), usage: null, model: null, totalMs: Date.now() - this.startedAt }
  }

  private elapsed(name: string): number {
    return Date.now() - (this.since.get(name) ?? this.startedAt)
  }
}

export async function analyzeImage(opts: AnalyzeOptions): Promise<RunOutcome> {
  const trace = new TraceRecorder(opts.onStep)
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
      return trace.fail(trace.activeName(), message, message)
    }
    if (timedOut) {
      trace.settle(TIMED_OUT_DETAIL)
      return { status: 'failed', message: TIMED_OUT_MESSAGE, truncated: false, summary: trace.localSummary() }
    }
    trace.settle(STOPPED_DETAIL)
    return { status: 'cancelled', summary: trace.localSummary() }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', stopFromCaller)
  }
}

async function runRequest(opts: AnalyzeOptions, trace: TraceRecorder, signal: AbortSignal): Promise<RunOutcome> {
  const problem = fileProblem(opts.file)
  if (problem) return trace.fail('Request checked', problem, problem)

  let encoded: DataUrlParts
  try {
    encoded = await fileToBase64(opts.file)
  } catch {
    return trace.fail('Request checked', UNREADABLE_MESSAGE, UNREADABLE_MESSAGE)
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
    return trace.fail('Request checked', NETWORK_MESSAGE, NETWORK_MESSAGE)
  }

  if (!response.ok) return rejectedRequest(response, trace)
  if (!response.body) return trace.fail('Request checked', NO_RESULT_MESSAGE, NO_RESULT_MESSAGE)
  return readStream(response.body, opts, trace)
}

// The server answers before streaming starts with a JSON error. When it includes
// a trace, the failed step is shown exactly as the server recorded it.
async function rejectedRequest(response: Response, trace: TraceRecorder): Promise<RunOutcome> {
  const body: unknown = await response.json().catch(() => null)
  const fields: Record<string, unknown> = isRecord(body) ? body : {}
  const message =
    typeof fields.error === 'string' && fields.error
      ? fields.error
      : `The analysis could not start (HTTP ${response.status}). Please try again.`
  const steps = fields.trace
  if (!Array.isArray(steps)) return trace.fail('Request checked', message, message)
  for (const step of steps.filter(isTraceStep)) trace.record(step)
  return { status: 'failed', message, truncated: false, summary: trace.localSummary() }
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  opts: AnalyzeOptions,
  trace: TraceRecorder,
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
        return trace.fail('Model call', DROPPED_MESSAGE, DROPPED_MESSAGE)
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
    return handleLine(buffer, opts, trace) ?? trace.fail('Model call', DROPPED_MESSAGE, DROPPED_MESSAGE)
  } finally {
    void reader.cancel().catch(() => undefined)
  }
}

// Returns the outcome when the line is the terminal frame, otherwise null.
function handleLine(line: string, opts: AnalyzeOptions, trace: TraceRecorder): RunOutcome | null {
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
  const frame = parsed as StreamFrame

  if (frame.stage === 'step' && isTraceStep(frame.step)) {
    trace.record(frame.step)
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

function summaryFrom(frame: StreamFrame, trace: TraceRecorder): RunSummary {
  return {
    trace: Array.isArray(frame.trace) ? frame.trace.filter(isTraceStep) : trace.steps.slice(),
    usage: isRecord(frame.usage) ? (frame.usage as RunUsage) : null,
    model: typeof frame.model === 'string' ? frame.model : null,
    totalMs: typeof frame.totalMs === 'number' ? frame.totalMs : trace.localSummary().totalMs,
  }
}

function isTraceStep(value: unknown): value is TraceStep {
  if (!isRecord(value)) return false
  return (
    typeof value.name === 'string' &&
    typeof value.detail === 'string' &&
    typeof value.status === 'string' &&
    STEP_STATUSES.includes(value.status)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAbortError(err: unknown): boolean {
  return isRecord(err) && err.name === 'AbortError'
}
