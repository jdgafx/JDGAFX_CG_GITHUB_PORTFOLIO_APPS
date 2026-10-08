import type { BotStep, PlanResponse, RunEvent, StepAction, TraceEntry, TraceStatus, UsageReport } from '../types'

const ACTIONS: StepAction[] = ['navigate', 'find', 'click', 'type', 'extract', 'verify']
const TRACE_STATUSES: TraceStatus[] = ['ok', 'failed', 'skipped']
const EVENT_TYPES: RunEvent['type'][] = ['session', 'stage', 'step_start', 'step_complete', 'result', 'error', 'done']
const MAX_ERROR_CHARS = 300
const NETWORK_COPY = 'Could not reach the server. Check your connection and try again.'
const UNREADABLE_EVENT_COPY = 'The browser run sent a message the page could not read.'

/** A failed request. `message` is curated copy. `trace` holds the stages measured before the failure. */
export class RequestFailure extends Error {
  readonly trace: TraceEntry[]

  constructor(message: string, trace: TraceEntry[] = []) {
    super(message)
    this.trace = trace
  }
}

/** Copy for a response with no curated error text. The response body is never shown. */
function statusCopy(status: number): string {
  if (status === 429) return 'Rate limited, try again in a minute'
  if (status >= 500) return 'The AI provider did not answer in time'
  return `The request failed with HTTP ${status}. Try again in a moment.`
}

function toTrace(raw: unknown): TraceEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): TraceEntry[] => {
    const entry = item as Partial<TraceEntry> | null
    if (!entry || typeof entry.name !== 'string' || !TRACE_STATUSES.includes(entry.status as TraceStatus)) return []
    return [{
      name: entry.name,
      status: entry.status as TraceStatus,
      ms: typeof entry.ms === 'number' ? entry.ms : 0,
      detail: typeof entry.detail === 'string' ? entry.detail : '',
      tokens: typeof entry.tokens === 'number' ? entry.tokens : undefined,
      cost: typeof entry.cost === 'number' ? entry.cost : undefined,
    }]
  })
}

function toUsage(raw: unknown): UsageReport {
  const source = (raw ?? {}) as Record<string, unknown>
  const figure = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  return {
    prompt_tokens: figure(source.prompt_tokens),
    completion_tokens: figure(source.completion_tokens),
    total_tokens: figure(source.total_tokens),
    cost: figure(source.cost),
  }
}

function toStep(raw: unknown): BotStep | null {
  if (!raw || typeof raw !== 'object') return null
  const step = raw as Record<string, unknown>
  if (typeof step.action !== 'string' || !ACTIONS.includes(step.action as StepAction)) return null
  if (typeof step.target !== 'string' || typeof step.thought !== 'string') return null
  return {
    action: step.action as StepAction,
    target: step.target,
    thought: step.thought,
    value: typeof step.value === 'string' ? step.value : undefined,
    url: typeof step.url === 'string' ? step.url : undefined,
  }
}

const isStep = (step: BotStep | null): step is BotStep => step !== null

interface ErrorBody {
  error?: unknown
  trace?: unknown
}

/** Shows only the server's own curated error text. Anything else gets plain status copy. */
async function readFailure(response: Response): Promise<RequestFailure> {
  let body: ErrorBody | null = null
  try {
    body = JSON.parse(await response.text()) as ErrorBody | null
  } catch {
    // Not JSON, such as a gateway page. Never show it raw.
  }
  const error = typeof body?.error === 'string' ? body.error.trim().slice(0, MAX_ERROR_CHARS) : ''
  return new RequestFailure(error || statusCopy(response.status), toTrace(body?.trace))
}

/** Posts JSON to the server. A network failure becomes curated copy, unless the caller cancelled. */
async function postJson(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new RequestFailure(NETWORK_COPY)
  }
}

export async function planTask(task: string, signal: AbortSignal): Promise<PlanResponse> {
  const response = await postJson('/api/ai', { task }, signal)
  if (!response.ok) throw await readFailure(response)

  let data: { result?: { steps?: unknown }; trace?: unknown; usage?: unknown; model?: unknown; totalMs?: unknown }
  try {
    data = await response.json()
  } catch {
    throw new RequestFailure('The agent returned a response that was not valid JSON.')
  }

  const rawSteps = data.result?.steps
  const steps = Array.isArray(rawSteps) ? rawSteps.map(toStep).filter(isStep) : []
  if (steps.length === 0) throw new RequestFailure('The agent returned no usable steps for this task.')

  return {
    result: { steps },
    trace: toTrace(data.trace),
    usage: toUsage(data.usage),
    model: typeof data.model === 'string' ? data.model : null,
    totalMs: typeof data.totalMs === 'number' ? data.totalMs : 0,
  }
}

/** Reads the next chunk of the stream. A dropped connection becomes curated copy, unless the caller cancelled. */
async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  try {
    return await reader.read()
  } catch (error) {
    if (signal.aborted) throw error
    throw new RequestFailure(NETWORK_COPY)
  }
}

/** The text after "data: " on a record's data line, or undefined when the record has none (a comment or keep-alive). */
function dataLine(record: string): string | undefined {
  return record.split('\n').find((item) => item.startsWith('data: '))?.slice(6)
}

/** The event a data line carries, or null when it is not valid JSON or not a known event type. */
function eventOf(data: string): RunEvent | null {
  let parsed: { type?: unknown } | null
  try {
    parsed = JSON.parse(data) as { type?: unknown } | null
  } catch {
    return null
  }
  return typeof parsed?.type === 'string' && EVENT_TYPES.includes(parsed.type as RunEvent['type'])
    ? parsed as RunEvent
    : null
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
export async function streamRun(steps: BotStep[], onEvent: (event: RunEvent) => void, signal: AbortSignal): Promise<void> {
  const response = await postJson('/api/execute', { steps }, signal)
  if (!response.ok || !response.body) throw await readFailure(response)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const chunk = await readChunk(reader, signal)
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
