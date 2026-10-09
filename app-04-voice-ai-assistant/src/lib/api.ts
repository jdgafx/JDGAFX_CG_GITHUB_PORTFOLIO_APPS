// Browser side of the two Netlify functions. Both answer with the steps that ran,
// and a failure carries the same steps, so the run card can mark the step that failed.
import { UserFacingError } from './errors'

export type StepStatus = 'ok' | 'failed' | 'skipped'

export interface TraceStep {
  name: string
  status: StepStatus
  ms: number
  detail: string
  tokens?: number
  cost?: number
  // A tool call such as weather("Lisbon"), and the page its data came from.
  call?: string
  source?: string
  // For weather: the reading slot the numbers belong to, and when the server fetched it.
  reading?: Reading
}

export interface Reading {
  time: string
  zone: string
  abbreviation?: string
  intervalSeconds?: number
  fetchedAt: string
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

// What the UI keeps: the wire shape, a stable key, and the model that answered. A
// question that got no answer carries the reason in `unsent`.
export interface ChatMessage extends Message {
  id: string
  model?: string
  unsent?: string
}

// Recorded audio, ready for the transcribe endpoint.
export interface EncodedAudio {
  data: string
  format: string
}

interface TranscribeResult {
  text: string
  model?: string
  trace: TraceStep[]
  totalMs?: number
}

// A failed call, with the steps that ran before it failed.
export class RunError extends UserFacingError {
  readonly trace: TraceStep[]
  readonly totalMs?: number

  constructor(message: string, trace: TraceStep[] = [], totalMs?: number) {
    super(message, 'RunError')
    this.trace = trace
    this.totalMs = totalMs
  }
}

// How long the browser waits for one function call. The server's own budget is 25
// seconds, so a normal answer arrives first. The browser stops waiting at about the
// platform's own limit rather than sitting on a hung connection.
const CLIENT_TIMEOUT_MS = 30_000
const UNREACHABLE = 'Could not reach the server. Check your connection and try again.'
const TIMED_OUT = 'The server did not answer in time. Try again.'

// The trace stage a call reports under, when it started, and the caller's cancel signal.
export interface CallContext {
  stage: string
  started: number
  signal?: AbortSignal
}

export const STATUSES: readonly string[] = ['ok', 'failed', 'skipped']

export function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function errorName(err: unknown): string {
  return typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string' ? err.name : ''
}

// The browser's own deadline ends a call with one of these names. A cancel from the
// caller is checked separately, before this.
export function isDeadlineError(err: unknown): boolean {
  const name = errorName(err)
  return name === 'TimeoutError' || name === 'AbortError'
}

// A source becomes a link, so only an http(s) address is kept.
function safeLink(value: string): string | undefined {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:' ? value : undefined
  } catch {
    return undefined
  }
}

export function failedStep(name: string, started: number, detail: string): TraceStep {
  return { name, status: 'failed', ms: Date.now() - started, detail }
}

export function timedOut(call: CallContext): RunError {
  return new RunError(TIMED_OUT, [failedStep(call.stage, call.started, 'No reply before the time limit')])
}

function parseReading(raw: unknown): Reading | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.time !== 'string' || typeof r.fetchedAt !== 'string') return undefined
  return {
    time: r.time,
    zone: typeof r.zone === 'string' ? r.zone : 'local time',
    abbreviation: typeof r.abbreviation === 'string' ? r.abbreviation : undefined,
    intervalSeconds: numberOrUndefined(r.intervalSeconds),
    fetchedAt: r.fetchedAt,
  }
}

// Only well-formed steps reach the UI, whatever the server sent.
export function parseTrace(raw: unknown): TraceStep[] {
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
      call: typeof s.call === 'string' ? s.call : undefined,
      source: typeof s.source === 'string' ? safeLink(s.source) : undefined,
      reading: parseReading(s.reading),
    })
  }
  return steps
}

export function parseUsage(raw: unknown): Usage | undefined {
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

// Reads the JSON body. A cancel from the caller is rethrown. A deadline during the read
// is the timeout failure. Any other unreadable body returns null, so the caller can
// fall back to its own copy.
export async function readBody(res: Response, call: CallContext): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await res.json()
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
  } catch (err) {
    if (call.signal?.aborted) throw err
    if (isDeadlineError(err)) throw timedOut(call)
    return null
  }
}

// Used only when the function did not answer with JSON: a platform timeout (504), a
// platform size limit (413), or a proxy page. The provider name is the subject.
export function statusFallback(status: number, provider: string): string {
  if (status === 413) return 'That recording is too long to send. Try a shorter one.'
  if (status === 504) return `${provider} did not answer in time.`
  if (status === 429) return `${provider} is rate limited. Wait a moment and try again.`
  if (status === 403) return `${provider} rejected this request.`
  if (status >= 500) return `${provider} is unavailable right now. Try again in a moment.`
  return `${provider} did not accept the request.`
}

// One call to a function. A cancel from the caller passes through untouched, so
// Cancel keeps working. A deadline or a dropped connection becomes a failed step.
export async function send(call: CallContext, url: string, init: RequestInit): Promise<Response> {
  const deadline = AbortSignal.timeout(CLIENT_TIMEOUT_MS)
  const signal = AbortSignal.any(call.signal ? [call.signal, deadline] : [deadline])
  try {
    return await fetch(url, { ...init, signal })
  } catch (err) {
    if (call.signal?.aborted) throw err
    if (isDeadlineError(err)) throw timedOut(call)
    console.error(`${url} request failed:`, err)
    throw new RunError(UNREACHABLE, [failedStep(call.stage, call.started, 'The request did not reach the server')])
  }
}

export async function readFailure(res: Response, provider: string, call: CallContext): Promise<RunError> {
  const data = await readBody(res, call)
  const error = data?.error
  const message = typeof error === 'string' && error.trim() ? error : statusFallback(res.status, provider)
  const trace = parseTrace(data?.trace)
  return new RunError(
    message,
    trace.length > 0 ? trace : [failedStep(call.stage, call.started, message)],
    numberOrUndefined(data?.totalMs),
  )
}

export async function transcribe(clip: EncodedAudio, signal?: AbortSignal): Promise<TranscribeResult> {
  const call: CallContext = { stage: 'speech to text', started: Date.now(), signal }
  const res = await send(call, '/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: clip.data, format: clip.format }),
  })
  if (!res.ok) throw await readFailure(res, 'The transcription service', call)

  const data = await readBody(res, call)
  if (!data) {
    throw new RunError('The transcription service returned an unreadable response.', [
      failedStep(call.stage, call.started, 'The reply was not JSON'),
    ])
  }
  return {
    text: typeof data.result === 'string' ? data.result : '',
    model: typeof data.model === 'string' ? data.model : undefined,
    trace: parseTrace(data.trace),
    totalMs: numberOrUndefined(data.totalMs),
  }
}
