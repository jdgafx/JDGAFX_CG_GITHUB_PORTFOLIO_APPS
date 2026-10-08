export const STAGE_IDS = ['research', 'outline', 'draft', 'edit', 'polish'] as const
export type StageId = (typeof STAGE_IDS)[number]

export const STAGE_LABELS: Record<StageId, string> = {
  research: 'Research',
  outline: 'Outline',
  draft: 'Draft',
  edit: 'Edit',
  polish: 'Polish',
}

export const CONTENT_TYPES = ['Blog Post', 'Technical Article', 'Marketing Copy', 'Newsletter', 'Social Thread'] as const
export type ContentType = (typeof CONTENT_TYPES)[number]

export type StageOutputs = Partial<Record<StageId, string>>

export interface Usage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost?: number
}

export interface TraceRow {
  name: string
  status: 'ok' | 'failed'
  ms: number
  detail: string
  tokens?: number
  cost?: number
}

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
}

interface PipelineCallbacks {
  onStageStart: (stage: StageId) => void
  onCall: (record: CallRecord) => void
  onStageDone: (stage: StageId, content: string) => void
}

const API_PATH = '/api/ai'
// The browser retries a stage once, and only when the server says its output was empty or cut short.
const RETRY_LIMIT = 1

const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.'
const BUSY_MESSAGE = 'Rate limited, try again in a minute.'
const SLOW_MESSAGE = 'The AI provider did not answer in time.'
const GENERIC_MESSAGE = 'The request could not be completed. Please retry.'
const NO_TEXT_MESSAGE = 'The stage returned no usable text. Please retry.'
const UNEXPECTED_MESSAGE = 'Something went wrong. Please retry.'

// A failed call. The record is its trace line, and `retryable` says whether a second call may succeed.
class StageFailure extends Error {
  constructor(message: string, readonly retryable: boolean, readonly record: CallRecord) {
    super(message)
  }
}

interface Attempt {
  usage: Usage | null
  model: string | null
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function friendlyHttpError(status: number): string {
  if (status === 429) return BUSY_MESSAGE
  if (status >= 500) return SLOW_MESSAGE
  return GENERIC_MESSAGE
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

async function readBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json()
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch (err) {
    if (isAbort(err)) throw err
    return null
  }
}

// One call to the server for one stage. `name` labels the trace line ("Draft" or "Draft (retry)").
async function postStage(
  req: RunRequest,
  stage: StageId,
  name: string,
): Promise<{ content: string; record: CallRecord }> {
  const sentAt = Date.now()
  const elapsed = () => Date.now() - sentAt
  let response: Response
  try {
    response = await fetch(API_PATH, {
      method: 'POST',
      signal: req.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: req.topic, contentType: req.contentType, stage, context: req.context }),
    })
  } catch (err) {
    if (isAbort(err)) throw err
    throw new StageFailure(NETWORK_MESSAGE, false, {
      stage,
      usage: null,
      model: null,
      row: { name, status: 'failed', ms: elapsed(), detail: 'Connection lost before the stage finished.' },
    })
  }

  const body = await readBody(response)
  const serverRow = readRow(body?.trace)
  const attempt: Attempt = { usage: readUsage(body?.usage), model: typeof body?.model === 'string' ? body.model : null }

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
    throw new StageFailure(NO_TEXT_MESSAGE, true, {
      stage,
      ...attempt,
      row: { name, status: 'failed', ms: elapsed(), detail: 'The response had no usable text.' },
    })
  }
  return {
    content,
    record: { stage, row: { ...serverRow, name }, usage: attempt.usage, model: attempt.model },
  }
}

async function runStage(req: RunRequest, stage: StageId, callbacks: PipelineCallbacks): Promise<string> {
  const label = STAGE_LABELS[stage]
  for (let attempt = 0; ; attempt += 1) {
    const name = attempt === 0 ? label : `${label} (retry)`
    try {
      const { content, record } = await postStage(req, stage, name)
      callbacks.onCall(record)
      return content
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
      const content = await runStage({ ...req, context }, stage, callbacks)
      context[stage] = content
      callbacks.onStageDone(stage, content)
    } catch (err) {
      if (isAbort(err) || req.signal.aborted) return { kind: 'stopped', stage }
      const message = err instanceof StageFailure ? err.message : UNEXPECTED_MESSAGE
      return { kind: 'failed', stage, message }
    }
  }
  return { kind: 'complete' }
}
