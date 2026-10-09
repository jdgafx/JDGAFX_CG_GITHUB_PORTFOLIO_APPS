import type { RunUsage } from '../../src/types'
import { withDeadline } from './deadline'

/**
 * The one module that calls the model. Every chat or text call goes through
 * callModel(), which always sends MODEL. Request bodies cannot change the model,
 * and the only environment variable read here is the key.
 */
export const MODEL = 'anthropic/claude-haiku-5.5'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/** Explicit cap on every call. With reasoning off, the whole budget goes to the visible JSON. */
const MAX_TOKENS = 4096

/**
 * The most one model call may take. Over 24 live plan calls (first questions and follow-ups) the median was
 * 1.7 s, p95 2.6 s and the slowest 4.1 s, so 6 s is 1.5 times the slowest healthy call. A call that hangs
 * is cut here and, budget allowing, repeated once.
 */
export const CALL_LIMIT_MS = 6_000
/** A retry after a timeout needs at least this much of the run budget left, or the failure is reported. */
const RETRY_MIN_MS = 6_000

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ModelReply {
  text: string
  finish: string | null
  model: string | null
  usage: RunUsage
  attempts: number
  /** Why the call was repeated once, when it was: the first try hit the call limit or lost the connection. */
  retriedAfter: 'timeout' | 'connection' | null
}

/** An HTTP error from the provider. Only the status is kept; the body is never shown. */
export class ProviderError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Provider returned HTTP ${status}.`)
    this.name = 'ProviderError'
    this.status = status
  }
}

const USAGE_KEYS = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const

export function getApiKey(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null
}

function readUsage(raw: unknown): RunUsage {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out: RunUsage = {}
  for (const key of USAGE_KEYS) {
    const value = data[key]
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

/** Adds usage across calls. A total is reported only when every call reported that field. */
export function sumUsage(parts: RunUsage[]): RunUsage {
  if (parts.length === 0) return {}
  const out: RunUsage = {}
  for (const key of USAGE_KEYS) {
    const values = parts.map((part) => part[key])
    if (values.every((value): value is number => typeof value === 'number')) {
      out[key] = values.reduce((sum, value) => sum + value, 0)
    }
  }
  return out
}

interface RawReply {
  text: string
  finish: string | null
  model: string | null
  usage: RunUsage
}

// Each try runs against its own referenced timer and the run's signal, body read included.
function requestOnce(messages: ChatMessage[], apiKey: string, signal: AbortSignal): Promise<RawReply> {
  return withDeadline(CALL_LIMIT_MS, signal, (own) => readOnce(messages, apiKey, own), 'AbortError')
}

async function readOnce(messages: ChatMessage[], apiKey: string, signal: AbortSignal): Promise<RawReply> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      reasoning: { enabled: false },
      response_format: { type: 'json_object' },
      usage: { include: true },
      messages,
    }),
  })
  if (!response.ok) throw new ProviderError(response.status)

  let data: {
    model?: unknown
    usage?: unknown
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>
  } = {}
  try {
    data = await response.json()
  } catch (err) {
    // A body that is not JSON reads as an empty reply. Aborts and network errors still propagate.
    if (!(err instanceof SyntaxError)) throw err
  }
  const choice = data.choices?.[0]
  return {
    text: typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '',
    finish: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    model: typeof data.model === 'string' ? data.model : null,
    usage: readUsage(data.usage),
  }
}

export interface CallOptions {
  /** When the run's budget ends (Date.now() scale). A retry is skipped when too little is left. */
  deadlineAt?: number
}

/** A try that ran out of time or lost the connection may be repeated once. An HTTP answer or a stop may not. */
function retryKind(err: unknown, signal: AbortSignal): 'timeout' | 'connection' | null {
  if (signal.aborted || err instanceof ProviderError) return null
  if (err instanceof Error && err.name === 'AbortError') return 'timeout'
  return err instanceof TypeError ? 'connection' : null
}

/**
 * One chat call. An empty reply gets one more attempt. A cut-off reply does not,
 * because the same prompt would be cut off again; the caller reports it instead.
 * A try that times out or loses the connection is repeated once while the run budget allows.
 */
export async function callModel(
  messages: ChatMessage[],
  signal: AbortSignal,
  options: CallOptions = {},
): Promise<ModelReply> {
  const apiKey = getApiKey()
  if (!apiKey) throw new ProviderError(401)

  let retriedAfter: ModelReply['retriedAfter'] = null
  const attempt = async (): Promise<RawReply> => {
    try {
      return await requestOnce(messages, apiKey, signal)
    } catch (err) {
      const kind = retryKind(err, signal)
      const roomLeft = options.deadlineAt === undefined || options.deadlineAt - Date.now() >= RETRY_MIN_MS
      if (!kind || retriedAfter || !roomLeft) throw err
      retriedAfter = kind
      return await requestOnce(messages, apiKey, signal)
    }
  }

  const first = await attempt()
  if (first.text || first.finish === 'length') return { ...first, attempts: 1, retriedAfter }

  const second = await attempt()
  return {
    text: second.text,
    finish: second.finish,
    model: second.model ?? first.model,
    usage: sumUsage([first.usage, second.usage]),
    attempts: 2,
    retriedAfter,
  }
}

/** Maps a failed model call to our HTTP status and a plain-language message. Never the raw body. */
export function describeFailure(err: unknown): { status: number; message: string } {
  if (err instanceof ProviderError) {
    if (err.status === 401 || err.status === 402 || err.status === 403) {
      return { status: 502, message: 'The AI provider rejected the key or is out of credit.' }
    }
    if (err.status === 429) return { status: 429, message: 'Rate limited, try again in a minute.' }
    if (err.status >= 500) return { status: 502, message: 'The AI provider did not answer in time.' }
    return { status: 502, message: 'The AI provider rejected the request.' }
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return { status: 504, message: 'The AI provider did not answer in time.' }
  }
  return { status: 502, message: 'Could not reach the AI provider. Try again.' }
}
