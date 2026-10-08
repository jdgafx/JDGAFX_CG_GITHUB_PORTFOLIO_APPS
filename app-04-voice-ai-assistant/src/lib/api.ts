// Browser side of the two Netlify functions. Both answer with the steps that ran,
// and a failure carries the same steps, so the run card can mark the step that failed.
import type { EncodedAudio } from './audio'

export type StepStatus = 'ok' | 'failed' | 'skipped'

export interface TraceStep {
  name: string
  status: StepStatus
  ms: number
  detail: string
  tokens?: number
  cost?: number
}

export interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost?: number
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

// What the UI keeps: the wire shape, a stable key, and the model that answered.
export interface ChatMessage extends Message {
  id: string
  model?: string
}

export interface ChatResult {
  text: string
  model?: string
  usage?: Usage
  trace: TraceStep[]
  totalMs?: number
}

export interface TranscribeResult {
  text: string
  model?: string
  trace: TraceStep[]
  totalMs?: number
}

// A failed call, with the steps that ran before it failed.
export class RunError extends Error {
  readonly trace: TraceStep[]
  readonly totalMs?: number

  constructor(message: string, trace: TraceStep[] = [], totalMs?: number) {
    super(message)
    this.name = 'RunError'
    this.trace = trace
    this.totalMs = totalMs
  }
}

const STATUSES: readonly string[] = ['ok', 'failed', 'skipped']

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function failedStep(name: string, started: number, detail: string): TraceStep {
  return { name, status: 'failed', ms: Date.now() - started, detail }
}

// Only well-formed steps reach the UI, whatever the server sent.
function parseTrace(raw: unknown): TraceStep[] {
  if (!Array.isArray(raw)) return []
  const steps: TraceStep[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const s = item as Record<string, unknown>
    if (typeof s.name !== 'string' || typeof s.detail !== 'string' || typeof s.ms !== 'number') continue
    if (typeof s.status !== 'string' || !STATUSES.includes(s.status)) continue
    steps.push({
      name: s.name,
      status: s.status as StepStatus,
      ms: s.ms,
      detail: s.detail,
      tokens: numberOrUndefined(s.tokens),
      cost: numberOrUndefined(s.cost),
    })
  }
  return steps
}

function parseUsage(raw: unknown): Usage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const u = raw as Record<string, unknown>
  const usage: Usage = {
    prompt_tokens: numberOrUndefined(u.prompt_tokens),
    completion_tokens: numberOrUndefined(u.completion_tokens),
    total_tokens: numberOrUndefined(u.total_tokens),
    cost: numberOrUndefined(u.cost),
  }
  return Object.values(usage).some(value => value !== undefined) ? usage : undefined
}

async function readBody(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await res.json()
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
  } catch (err) {
    if (isAbortError(err)) throw err
    return null
  }
}

// Used only when the function did not answer with JSON (an edge timeout or a proxy page).
function statusFallback(status: number, subject: string): string {
  if (status === 413) return 'That recording is too long to send. Try a shorter one.'
  if (status === 429) return `${subject} is rate limited. Wait a moment and try again.`
  if (status === 403) return `${subject} rejected this request.`
  if (status >= 500) return `${subject} is unavailable right now. Try again in a moment.`
  return `${subject} did not accept the request.`
}

// A transport failure (offline, DNS, dropped connection) rejects before any
// Response exists. Abort must pass through untouched so Cancel keeps working.
async function send(
  stage: string,
  url: string,
  init: RequestInit,
  offlineMessage: string,
  started: number,
): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (err) {
    if (isAbortError(err)) throw err
    console.error(`${url} request failed:`, err)
    throw new RunError(offlineMessage, [failedStep(stage, started, 'The request did not reach the server')])
  }
}

async function readFailure(res: Response, subject: string, stage: string, started: number): Promise<RunError> {
  const data = await readBody(res)
  const error = data?.error
  const message = typeof error === 'string' && error.trim() ? error : statusFallback(res.status, subject)
  const trace = parseTrace(data?.trace)
  return new RunError(
    message,
    trace.length > 0 ? trace : [failedStep(stage, started, message)],
    numberOrUndefined(data?.totalMs),
  )
}

export async function transcribe(clip: EncodedAudio, signal?: AbortSignal): Promise<TranscribeResult> {
  const started = Date.now()
  const res = await send(
    'speech to text',
    '/api/transcribe',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: clip.data, format: clip.format }),
      signal,
    },
    'Could not reach the transcription service. Check your connection and try again.',
    started,
  )
  if (!res.ok) throw await readFailure(res, 'Transcription', 'speech to text', started)

  const data = await readBody(res)
  if (!data) {
    throw new RunError('Transcription service returned an unreadable response.', [
      failedStep('speech to text', started, 'The reply was not JSON'),
    ])
  }
  return {
    text: typeof data.result === 'string' ? data.result : '',
    model: typeof data.model === 'string' ? data.model : undefined,
    trace: parseTrace(data.trace),
    totalMs: numberOrUndefined(data.totalMs),
  }
}

export async function chat(message: string, history: Message[], signal?: AbortSignal): Promise<ChatResult> {
  const started = Date.now()
  const res = await send(
    'model call',
    '/api/ai',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
      signal,
    },
    'Could not reach the assistant. Check your connection and try again.',
    started,
  )
  if (!res.ok) throw await readFailure(res, 'The assistant', 'model call', started)

  const data = await readBody(res)
  if (!data) {
    throw new RunError('The assistant returned an unreadable response.', [
      failedStep('model call', started, 'The reply was not JSON'),
    ])
  }
  const trace = parseTrace(data.trace)
  const totalMs = numberOrUndefined(data.totalMs)
  const text = typeof data.result === 'string' ? data.result.trim() : ''
  if (!text) throw new RunError('The assistant returned an empty response. Try again.', trace, totalMs)
  return {
    text,
    model: typeof data.model === 'string' ? data.model : undefined,
    usage: parseUsage(data.usage),
    trace,
    totalMs,
  }
}
