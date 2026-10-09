import { isRecord } from './guards'
import { cropRegion, fileProblem, fitForCompare, parseDataUrl, type CropResult, type DataUrlParts } from './image'
import { describeRect, isSmallCrop, type Box } from './region'
import {
  STEP_STATUSES,
  activeName,
  elapsed,
  newTrace,
  record,
  settle,
  upsertStep,
  type Trace,
  type TraceStep,
} from './trace'

export { upsertStep }
export type { StepStatus, TraceStep } from './trace'

export type AnalysisMode = 'describe' | 'analyze' | 'qa' | 'extract' | 'region' | 'compare'

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
  /** Region mode: the box to cut out of `file`. The crop is reported through onCrop as soon as it exists. */
  box?: Box
  onCrop?: (crop: CropResult) => void
  /** Compare mode: the second image. */
  fileB?: File
  signal?: AbortSignal
  onStep: (step: TraceStep) => void
  onText: (text: string) => void
}

// Longest question the server accepts. The question input enforces the same limit.
export const MAX_QUESTION_CHARS = 1000

// The server stops every provider call at 25 seconds and always sends a final frame. Two guards cover a
// connection that stalls anyway: no byte for 30 seconds, and 60 seconds in all (server budget plus a wide margin).
export const REQUEST_TIMEOUT_MS = 60_000
export const IDLE_TIMEOUT_MS = 30_000
// After the final frame the page lets the server close the stream rather than cancelling it, so the request ends cleanly.
const DRAIN_MS = 1_500

export const STEP_REACH = 'Reach the server'
const STEP_CHECK = 'Request checked'
const STEP_CROP = 'Crop region'
const STEP_PREPARE = 'Prepare images'
const STEP_MODEL = 'Model call'
const TIMED_OUT_MESSAGE = 'The AI provider did not answer in time.'
const TIMED_OUT_DETAIL = 'No answer within 60 seconds'
const STALLED_MESSAGE = 'No data arrived for 30 seconds, so the page stopped waiting. Run it again.'
const STALLED_DETAIL = 'No data for 30 seconds'
export const STOPPED_DETAIL = 'Stopped by you before it finished'
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

function localSummary(trace: Trace): RunSummary {
  return { trace: trace.steps, usage: null, model: null, totalMs: Date.now() - trace.startedAt }
}

function fail(trace: Trace, name: string, detail: string, message: string): RunOutcome {
  record(trace, { name, status: 'failed', ms: elapsed(trace, name), detail })
  return { status: 'failed', message, truncated: false, summary: localSummary(trace) }
}

export async function analyzeImage(opts: AnalyzeOptions): Promise<RunOutcome> {
  const trace = newTrace(opts.onStep)
  const controller = new AbortController()
  let timedOut = false
  let stalled = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  let idle: ReturnType<typeof setTimeout> | undefined
  // Called whenever a byte arrives; the page gives up if none arrives for IDLE_TIMEOUT_MS.
  const touch = () => {
    clearTimeout(idle)
    idle = setTimeout(() => {
      stalled = true
      controller.abort()
    }, IDLE_TIMEOUT_MS)
  }
  const stopFromCaller = () => controller.abort()
  if (opts.signal?.aborted) controller.abort()
  opts.signal?.addEventListener('abort', stopFromCaller)

  try {
    return await runRequest(opts, trace, controller.signal, touch)
  } catch (err) {
    if (!isAbortError(err)) {
      const message = 'The analysis stopped unexpectedly. Please try again.'
      return fail(trace, activeName(trace), message, message)
    }
    if (timedOut || stalled) {
      settle(trace, timedOut ? TIMED_OUT_DETAIL : STALLED_DETAIL)
      // No answer at all: nothing was running to settle, so say which step never finished.
      if (!trace.steps.some(step => step.name === STEP_MODEL)) {
        record(trace, { name: STEP_MODEL, status: 'failed', ms: Date.now() - trace.startedAt, detail: timedOut ? TIMED_OUT_DETAIL : STALLED_DETAIL })
      }
      return {
        status: 'failed',
        message: timedOut ? TIMED_OUT_MESSAGE : STALLED_MESSAGE,
        truncated: false,
        summary: localSummary(trace),
      }
    }
    settle(trace, STOPPED_DETAIL, 'stopped')
    return { status: 'cancelled', summary: localSummary(trace) }
  } finally {
    clearTimeout(timer)
    clearTimeout(idle)
    opts.signal?.removeEventListener('abort', stopFromCaller)
  }
}

// Region and compare cut or shrink pictures in the browser first; each is a trace step of its own.
async function prepare(opts: AnalyzeOptions, trace: Trace): Promise<{ primary: File; second?: File; region?: object } | RunOutcome> {
  if (opts.mode === 'region' && opts.box) {
    record(trace, { name: STEP_CROP, status: 'running', detail: 'Cutting the box out of the picture' })
    try {
      const crop = await cropRegion(opts.file, opts.box)
      opts.onCrop?.(crop)
      const small = isSmallCrop(crop.rect) ? ', small: the model may not read it' : ''
      record(trace, {
        name: STEP_CROP,
        status: 'ok',
        ms: elapsed(trace, STEP_CROP),
        detail: `${describeRect(crop.rect)} from ${describeRect({ x: 0, y: 0, width: crop.source.width, height: crop.source.height })}, ${Math.round(crop.file.size / 1024)} KB at full resolution${small}`,
      })
      return {
        primary: crop.file,
        region: { sourceWidth: crop.source.width, sourceHeight: crop.source.height, ...crop.rect },
      }
    } catch {
      return fail(trace, STEP_CROP, UNREADABLE_MESSAGE, UNREADABLE_MESSAGE)
    }
  }
  if (opts.mode === 'compare') {
    if (!opts.fileB) return fail(trace, STEP_CHECK, 'Comparing needs two images', 'Choose a second image to compare.')
    const second = fileProblem(opts.fileB)
    if (second) return fail(trace, STEP_CHECK, second, second)
    record(trace, { name: STEP_PREPARE, status: 'running', detail: 'Fitting both images into one request' })
    try {
      const [a, b] = await Promise.all([fitForCompare(opts.file), fitForCompare(opts.fileB)])
      const shrunk = [a.shrunk ? 'A' : '', b.shrunk ? 'B' : ''].filter(Boolean)
      record(trace, {
        name: STEP_PREPARE,
        status: 'ok',
        ms: elapsed(trace, STEP_PREPARE),
        detail: shrunk.length
          ? `Image ${shrunk.join(' and ')} scaled down to fit 2 MB`
          : 'Both images are under 2 MB and go as they are',
      })
      return { primary: a.file, second: b.file }
    } catch {
      return fail(trace, STEP_PREPARE, UNREADABLE_MESSAGE, UNREADABLE_MESSAGE)
    }
  }
  return { primary: opts.file }
}

async function runRequest(opts: AnalyzeOptions, trace: Trace, signal: AbortSignal, touch: () => void): Promise<RunOutcome> {
  const problem = fileProblem(opts.file)
  if (problem) return fail(trace, STEP_CHECK, problem, problem)

  const prepared = await prepare(opts, trace)
  if ('status' in prepared) return prepared

  let encoded: DataUrlParts
  let encodedB: DataUrlParts | null = null
  try {
    encoded = await fileToBase64(prepared.primary)
    if (prepared.second) encodedB = await fileToBase64(prepared.second)
  } catch {
    return fail(trace, STEP_CHECK, UNREADABLE_MESSAGE, UNREADABLE_MESSAGE)
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
        question: opts.mode === 'qa' || opts.mode === 'region' || opts.mode === 'compare' ? opts.question || undefined : undefined,
        image2: encodedB?.data,
        mediaType2: encodedB?.mediaType,
        region: prepared.region,
      }),
    })
  } catch (err) {
    if (isAbortError(err)) throw err
    // The server never saw the request, so it is not the "Request checked" step that failed.
    return fail(trace, STEP_REACH, NETWORK_MESSAGE, NETWORK_MESSAGE)
  }

  if (!response.ok) return rejectedRequest(response, trace)
  if (!response.body) return fail(trace, STEP_MODEL, NO_RESULT_MESSAGE, NO_RESULT_MESSAGE)
  touch()
  return readStream(response.body, opts, trace, touch)
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
  if (!Array.isArray(steps)) return fail(trace, STEP_CHECK, message, message)
  for (const step of steps.filter(isTraceStep)) record(trace, step)
  return { status: 'failed', message, truncated: false, summary: localSummary(trace) }
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  opts: AnalyzeOptions,
  trace: Trace,
  touch: () => void,
): Promise<RunOutcome> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let outcome: RunOutcome | null = null
  let ended = false
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await (outcome ? drain(reader) : reader.read())
      } catch (err) {
        // A socket that dies mid-stream throws a bare network error; say what happened instead.
        if (isAbortError(err)) throw err
        return outcome ?? fail(trace, STEP_MODEL, DROPPED_MESSAGE, DROPPED_MESSAGE)
      }
      if (chunk.done) {
        ended = true
        break
      }
      touch()
      // After the final frame only the closing bytes are left; they carry nothing to read.
      if (outcome) continue
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        outcome = handleLine(line, opts, trace)
        if (outcome) break
      }
    }
    if (outcome) return outcome
    buffer += decoder.decode()
    // No terminal frame means the connection dropped mid-analysis: never treat a partial answer as complete.
    return handleLine(buffer, opts, trace) ?? fail(trace, STEP_MODEL, DROPPED_MESSAGE, DROPPED_MESSAGE)
  } finally {
    // A stream that ran to its end needs no cancel; cancelling it would log as an aborted request.
    if (!ended) void reader.cancel().catch(() => undefined)
  }
}

// Reads once more, giving the server a moment to close the stream after its final frame.
function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ done: true, value: undefined }), DRAIN_MS)
    reader.read().then(
      result => {
        clearTimeout(timer)
        resolve(result)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
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
  // The server's trace covers its own steps; the steps the page ran first (crop, prepare) stay in front of them.
  const local = trace.steps.filter(step => step.name === STEP_CROP || step.name === STEP_PREPARE)
  const server = Array.isArray(frame.trace) ? frame.trace.filter(isTraceStep) : trace.steps
  return {
    trace: Array.isArray(frame.trace) ? [...local, ...server] : server,
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
