import type { ChangeNote } from '../../netlify/shared/changes'
import {
  STAGE_IDS, STAGE_LABELS, type ContentType, type StageId, type StageOutputs, type TraceRow, type Usage,
} from '../../netlify/shared/contract'

// One call to the server, with the usage and model the provider reported for it.
export interface CallRecord {
  stage: StageId
  row: TraceRow
  usage: Usage | null
  model: string | null
}

export type PipelineOutcome =
  | { kind: 'complete' }
  | { kind: 'stopped'; stage: StageId }
  | { kind: 'failed'; stage: StageId; message: string }

interface RunRequest {
  topic: string
  contentType: ContentType
  context: StageOutputs
  signal: AbortSignal
  // How long one request may take before the watchdog ends it. Tests shorten it.
  watchdogMs?: number
}

interface PipelineCallbacks {
  onStageStart: (stage: StageId) => void
  onCall: (record: CallRecord) => void
  onStageDone: (stage: StageId, content: string, notes: ChangeNote[]) => void
}

const API_PATH = '/api/ai'
// The browser retries a stage once, and only when the server says its output was empty or cut short.
const RETRY_LIMIT = 1

// A stage request is one short call (the server stops at about 22 s and Netlify at 26 s), so this
// cap, well past both, only ends a request that is stuck. It covers the body read as well.
export const WATCHDOG_MS = 60_000

export const SLOW_SERVER_MESSAGE = 'The server did not answer in time. Press Try again to run this step again.'
const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.'
export const UNEXPECTED_MESSAGE = 'Something went wrong. Please retry.'

// A failed call. The record is its trace line, and `retryable` says whether a second call may succeed.
class StageFailure extends Error {
  constructor(message: string, readonly retryable: boolean, readonly record: CallRecord) {
    super(message)
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function friendlyHttpError(status: number): string {
  if (status === 429) return 'Rate limited, try again in a minute.'
  if (status >= 500) return 'The AI provider did not answer in time.'
  return 'The request could not be completed. Please retry.'
}

function readUsage(value: unknown): Usage | null {
  if (!value || typeof value !== 'object') return null
  const usage = value as Record<string, unknown>
  if (typeof usage.prompt_tokens !== 'number' || typeof usage.completion_tokens !== 'number' || typeof usage.total_tokens !== 'number') {
    return null
  }
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    cost: typeof usage.cost === 'number' ? usage.cost : undefined,
  }
}

function readRow(value: unknown): TraceRow | null {
  const row = Array.isArray(value) ? (value[0] as Partial<TraceRow> | undefined) : undefined
  if (!row || typeof row.ms !== 'number' || typeof row.detail !== 'string') return null
  return {
    name: typeof row.name === 'string' ? row.name : '',
    status: row.status === 'ok' ? 'ok' : 'failed',
    ms: row.ms,
    detail: row.detail,
    tokens: typeof row.tokens === 'number' ? row.tokens : undefined,
    cost: typeof row.cost === 'number' ? row.cost : undefined,
  }
}

// Null when the body is not a JSON object. An abort or the watchdog ends the read with its own error.
async function readBody(response: Response, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json()
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch (err) {
    if (signal.aborted) throw err
    return null
  }
}

function readNotes(value: unknown): ChangeNote[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ChangeNote[] => {
    const note = item as Partial<ChangeNote> | null
    return note && typeof note.text === 'string' && typeof note.passage === 'string' && (note.side === 'new' || note.side === 'old')
      ? [{ text: note.text, passage: note.passage, side: note.side }]
      : []
  })
}

// One call to the server for one stage. `name` labels the trace line ("Draft" or "Draft (retry)").
async function postStage(
  req: RunRequest,
  stage: StageId,
  name: string,
): Promise<{ content: string; notes: ChangeNote[]; record: CallRecord }> {
  const sentAt = Date.now()
  const elapsed = () => Date.now() - sentAt
  const watchdog = AbortSignal.timeout(req.watchdogMs ?? WATCHDOG_MS)
  const signal = AbortSignal.any([req.signal, watchdog])
  // The user's own stop stays silent; the watchdog firing is a failure the page explains.
  const slow = () => new StageFailure(SLOW_SERVER_MESSAGE, false, {
    stage, usage: null, model: null, row: { name, status: 'failed', ms: elapsed(), detail: `No answer after ${(req.watchdogMs ?? WATCHDOG_MS) / 1000} s.` },
  })
  let response: Response
  try {
    response = await fetch(API_PATH, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: req.topic, contentType: req.contentType, stage, context: req.context }),
    })
  } catch (err) {
    if (req.signal.aborted) throw err
    if (watchdog.aborted) throw slow()
    throw new StageFailure(NETWORK_MESSAGE, false, {
      stage,
      usage: null,
      model: null,
      row: { name, status: 'failed', ms: elapsed(), detail: 'Connection lost before the stage finished.' },
    })
  }

  let body: Record<string, unknown> | null
  try {
    body = await readBody(response, signal)
  } catch (err) {
    if (req.signal.aborted) throw err
    throw slow()
  }
  const serverRow = readRow(body?.trace)
  const attempt: Pick<CallRecord, 'usage' | 'model'> = { usage: readUsage(body?.usage), model: typeof body?.model === 'string' ? body.model : null }

  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error.slice(0, 300) : friendlyHttpError(response.status)
    const row: TraceRow = serverRow
      ? { ...serverRow, name, status: 'failed' }
      : { name, status: 'failed', ms: elapsed(), detail: message }
    throw new StageFailure(message, body?.retryable === true, { stage, ...attempt, row })
  }

  if (!serverRow) {
    throw new StageFailure(UNEXPECTED_MESSAGE, false, {
      stage,
      ...attempt,
      row: { name, status: 'failed', ms: elapsed(), detail: 'The response had no trace.' },
    })
  }
  const content = typeof body?.result === 'string' ? body.result : ''
  if (!content.trim()) {
    throw new StageFailure('The stage returned no usable text. Please retry.', true, {
      stage,
      ...attempt,
      row: { name, status: 'failed', ms: elapsed(), detail: 'The response had no usable text.' },
    })
  }
  return {
    content,
    notes: readNotes(body?.notes),
    record: { stage, row: { ...serverRow, name }, usage: attempt.usage, model: attempt.model },
  }
}

async function runStage(req: RunRequest, stage: StageId, callbacks: PipelineCallbacks): Promise<{ content: string; notes: ChangeNote[] }> {
  const label = STAGE_LABELS[stage]
  for (let attempt = 0; ; attempt += 1) {
    const name = attempt === 0 ? label : `${label} (retry)`
    try {
      const { content, notes, record } = await postStage(req, stage, name)
      callbacks.onCall(record)
      return { content, notes }
    } catch (err) {
      if (isAbort(err) || req.signal.aborted) throw err
      if (!(err instanceof StageFailure)) throw err
      callbacks.onCall(err.record)
      if (!err.retryable || attempt >= RETRY_LIMIT) throw err
    }
  }
}

// Runs the stages that have no output yet, in order. Each stage is its own short call.
export async function runPipeline(req: RunRequest, callbacks: PipelineCallbacks): Promise<PipelineOutcome> {
  const context: StageOutputs = { ...req.context }
  for (const stage of STAGE_IDS) {
    if (context[stage]) continue
    if (req.signal.aborted) return { kind: 'stopped', stage }

    callbacks.onStageStart(stage)
    try {
      const { content, notes } = await runStage({ ...req, context }, stage, callbacks)
      context[stage] = content
      callbacks.onStageDone(stage, content, notes)
    } catch (err) {
      if (isAbort(err) || req.signal.aborted) return { kind: 'stopped', stage }
      const message = err instanceof StageFailure ? err.message : UNEXPECTED_MESSAGE
      return { kind: 'failed', stage, message }
    }
  }
  return { kind: 'complete' }
}
