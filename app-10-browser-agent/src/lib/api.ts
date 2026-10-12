import type { BotStep, ModelCheck, PlanResponse, PlanSpend, RunEvent, TraceEntry, TraceStatus } from '../types'
import { PLAN_CLIENT_WAIT_MS, RUN_CLIENT_WAIT_MS } from './budget'
import { cleanFrame } from './replay'
import { isAction, usageOf } from './shared'

const TRACE_STATUSES: TraceStatus[] = ['ok', 'failed', 'skipped']
const MODEL_CHECKS: ModelCheck[] = ['match', 'mismatch', 'unchecked', 'not-reported']
const EVENT_TYPES: RunEvent['type'][] = ['browser', 'stage', 'step_start', 'step_complete', 'result', 'error', 'done']
const MAX_ERROR_CHARS = 300
const NETWORK_COPY = 'Could not reach the server. Check your connection and try again.'
/** No byte from the run stream for this long means it has stalled. The server sends an event at least every few seconds. */
export const IDLE_LIMIT_MS = 30_000
/** The whole run stream: the server's worst case for a run plus a margin (src/lib/budget.ts), which stays under the platform's 60 s cut. */
export const OVERALL_LIMIT_MS = RUN_CLIENT_WAIT_MS
/** Time allowed for the run's response to begin. The first byte comes after the browser starts, which the server ends within 10 s. */
export const START_LIMIT_MS = 30_000
const STALLED_COPY = 'The browser run stopped sending updates. Run the plan again.'
const TOO_LONG_COPY = 'The browser run took longer than expected and was ended. Run the plan again.'
const NO_START_COPY = 'The server did not answer in time. Try again.'
const UNREADABLE_EVENT_COPY = 'The browser run sent a message the page could not read.'

/** A failed request. `message` is curated copy. `trace` holds the stages measured before the failure. */
export class RequestFailure extends Error {
  readonly trace: TraceEntry[]
  /** True for a gateway or server failure, or a cut connection: the kinds worth one more try. A 4xx, 429 or a stalled stream is final. */
  readonly retryable: boolean
  /** What the failed plan still spent. Null when the server named no model call. */
  readonly spend: PlanSpend | null

  constructor(message: string, trace: TraceEntry[] = [], retryable = false, spend: PlanSpend | null = null) {
    super(message)
    this.trace = trace
    this.retryable = retryable
    this.spend = spend
  }
}

/** Copy for a response with no curated error text. The response body is never shown. */
function statusCopy(status: number, kind: 'plan' | 'run'): string {
  if (status === 429) return 'Rate limited, try again in a minute'
  if (status >= 500) return kind === 'run' ? 'The browser service failed. Try again.' : 'The AI provider did not answer in time'
  return `The request failed with HTTP ${status}. Try again in a moment.`
}

function toTrace(raw: unknown): TraceEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): TraceEntry[] => {
    const entry = item as Partial<TraceEntry> | null
    if (!entry || typeof entry.name !== 'string' || !TRACE_STATUSES.includes(entry.status as TraceStatus)) return []
    const row: TraceEntry = {
      name: entry.name,
      status: entry.status as TraceStatus,
      ms: typeof entry.ms === 'number' ? entry.ms : 0,
      detail: typeof entry.detail === 'string' ? entry.detail : '',
    }
    // Null is a call whose usage never arrived. A row with no usage key is no billed call.
    if (entry.usage === null) row.usage = null
    else if (entry.usage && typeof entry.usage === 'object') row.usage = usageOf(entry.usage)
    return [row]
  })
}

function unreportedOf(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : 0
}

function modelCheckOf(raw: unknown): ModelCheck | null {
  return MODEL_CHECKS.find((check) => check === raw) ?? null
}

/** The billed figures a failed plan still reports, or null when it made no model call. */
function spendOf(body: ErrorBody | null): PlanSpend | null {
  const usage = body?.usage && typeof body.usage === 'object' ? usageOf(body.usage) : null
  const unreportedCalls = unreportedOf(body?.unreportedCalls)
  if (usage === null && unreportedCalls === 0) return null
  return {
    usage,
    unreportedCalls,
    model: typeof body?.model === 'string' ? body.model : null,
    newestModel: typeof body?.newestModel === 'string' ? body.newestModel : null,
    modelCheck: modelCheckOf(body?.modelCheck),
  }
}

function toStep(raw: unknown): BotStep | null {
  if (!raw || typeof raw !== 'object') return null
  const step = raw as Record<string, unknown>
  if (!isAction(step.action)) return null
  if (typeof step.target !== 'string' || typeof step.thought !== 'string') return null
  return {
    action: step.action,
    target: step.target,
    thought: step.thought,
    value: typeof step.value === 'string' ? step.value : undefined,
    url: typeof step.url === 'string' ? step.url : undefined,
    selector: typeof step.selector === 'string' ? step.selector : undefined,
  }
}

interface ErrorBody {
  error?: unknown
  trace?: unknown
  usage?: unknown
  unreportedCalls?: unknown
  model?: unknown
  newestModel?: unknown
  modelCheck?: unknown
}

/** Shows only the server's own curated error text. Anything else gets plain status copy. */
async function readFailure(response: Response, kind: 'plan' | 'run'): Promise<RequestFailure> {
  let body: ErrorBody | null = null
  try {
    body = JSON.parse(await response.text()) as ErrorBody | null
  } catch {
    // Not JSON, such as a gateway page. Never show it raw.
  }
  const error = typeof body?.error === 'string' ? body.error.trim().slice(0, MAX_ERROR_CHARS) : ''
  return new RequestFailure(error || statusCopy(response.status, kind), toTrace(body?.trace), response.status >= 500, spendOf(body))
}

/** Posts JSON to the server. A network failure becomes curated copy, unless the caller cancelled. */
async function postJson(path: string, body: unknown, signal: AbortSignal, startLimitMs = START_LIMIT_MS): Promise<Response> {
  // The limit covers the wait for the response to begin. The stream that follows has its own watchdog.
  const limit = AbortSignal.timeout(startLimitMs)
  try {
    return await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, limit]),
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new RequestFailure(limit.aborted ? NO_START_COPY : NETWORK_COPY, [], !limit.aborted)
  }
}

export async function planTask(task: string, signal: AbortSignal): Promise<PlanResponse> {
  const response = await postJson('/api/ai', { task }, signal, PLAN_CLIENT_WAIT_MS)
  if (!response.ok) throw await readFailure(response, 'plan')

  let data: { result?: { steps?: unknown }; trace?: unknown; usage?: unknown; unreportedCalls?: unknown; model?: unknown; newestModel?: unknown; modelCheck?: unknown; totalMs?: unknown }
  try {
    data = await response.json()
  } catch {
    throw new RequestFailure('The agent returned a response that was not valid JSON.')
  }

  const rawSteps = data.result?.steps
  const steps = Array.isArray(rawSteps) ? rawSteps.map(toStep).filter((step): step is BotStep => step !== null) : []
  if (steps.length === 0) throw new RequestFailure('The agent returned no usable steps for this task.')

  const model = typeof data.model === 'string' ? data.model : null
  return {
    result: { steps },
    trace: toTrace(data.trace),
    usage: usageOf(data.usage),
    unreportedCalls: unreportedOf(data.unreportedCalls),
    model,
    newestModel: typeof data.newestModel === 'string' ? data.newestModel : null,
    modelCheck: modelCheckOf(data.modelCheck) ?? (model === null ? 'not-reported' : 'unchecked'),
    totalMs: typeof data.totalMs === 'number' ? data.totalMs : 0,
  }
}

/** Reads the next chunk of the stream. A dropped connection becomes curated copy, unless the caller cancelled. */
async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  idleMs: number,
  overallLeftMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  // The watchdog is a referenced timer that races the read, so a stream that never delivers a byte still ends.
  const overall = overallLeftMs <= idleMs
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const watchdog = new Promise<never>((_, reject) => {
    // A visitor's Stop ends the wait at once, even if the body never reports the abort.
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => reject(new RequestFailure(overall ? TOO_LONG_COPY : STALLED_COPY)), Math.max(0, Math.min(idleMs, overallLeftMs)))
  })
  try {
    return await Promise.race([reader.read(), watchdog])
  } catch (error) {
    if (signal.aborted || error instanceof RequestFailure) throw error
    throw new RequestFailure(NETWORK_COPY, [], true)
  } finally {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

/** The text after "data: " on a record's data line, or undefined when the record has none (a comment or keep-alive). */
function dataLine(record: string): string | undefined {
  return record.split('\n').find((item) => item.startsWith('data: '))?.slice(6)
}

/** The event a data line carries, or null when it is not valid JSON or not a known event type. */
function eventOf(data: string): RunEvent | null {
  let parsed: { type?: unknown; [key: string]: unknown } | null
  try {
    parsed = JSON.parse(data) as { type?: unknown; [key: string]: unknown } | null
  } catch {
    return null
  }
  if (typeof parsed?.type !== 'string' || !EVENT_TYPES.includes(parsed.type as RunEvent['type'])) return null
  if (parsed.type !== 'step_complete') return parsed as RunEvent
  // A picture is checked before it reaches the page: only a small base64 JPEG gets through.
  const step = parsed as Extract<RunEvent, { type: 'step_complete' }>
  const { frame, note } = cleanFrame(step.frame)
  const frameNote = note ?? (typeof step.frameNote === 'string' ? step.frameNote.slice(0, 200) : undefined)
  // A repeat must name an earlier step. Anything else is dropped.
  const same = Number.isInteger(step.frameSameAs) && (step.frameSameAs as number) >= 0 && (step.frameSameAs as number) < step.index ? step.frameSameAs : undefined
  return { ...step, frame, frameNote, frameSameAs: frame ? undefined : same }
}

/** A complete record in the middle of the stream. Anything that is not a known event is a protocol error. */
function emitRecord(record: string, onEvent: (event: RunEvent) => void): void {
  const data = dataLine(record)
  if (data === undefined) return
  const event = eventOf(data)
  if (!event) throw new RequestFailure(UNREADABLE_EVENT_COPY)
  onEvent(event)
}

/**
 * The last piece of a stream that has ended. A whole event is delivered. A record the end of the
 * stream cut off is ignored, so the caller reports the run as ended before a result.
 */
function emitTail(tail: string, onEvent: (event: RunEvent) => void): void {
  const data = dataLine(tail)
  if (data === undefined) return
  const event = eventOf(data)
  if (event) onEvent(event)
}

/** Runs the plan and calls onEvent for each server event, in order, until the stream ends. */
export async function streamRun(
  steps: BotStep[],
  onEvent: (event: RunEvent) => void,
  signal: AbortSignal,
  limits: { idleMs: number; overallMs: number } = { idleMs: IDLE_LIMIT_MS, overallMs: OVERALL_LIMIT_MS },
): Promise<void> {
  const response = await postJson('/api/execute', { steps }, signal)
  if (!response.ok || !response.body) throw await readFailure(response, 'run')

  const startedAt = Date.now()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const chunk = await readChunk(reader, signal, limits.idleMs, limits.overallMs - (Date.now() - startedAt))
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      const records = buffer.split('\n\n')
      // The last piece is a record still in flight, unless the stream has ended.
      const tail = records.pop() ?? ''
      for (const record of records) emitRecord(record, onEvent)
      if (chunk.done) {
        emitTail(tail, onEvent)
        return
      }
      buffer = tail
    }
  } finally {
    // A throw leaves the body open, so it is cancelled here. On a body that has finished this does nothing.
    await reader.cancel().catch(() => undefined)
  }
}
