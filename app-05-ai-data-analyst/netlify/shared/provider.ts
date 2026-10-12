import type { RunUsage } from '../../src/types'
import { withDeadline } from './deadline'

/**
 * The one module that calls the model. Every chat or text call goes through
 * callModel(), which always sends MODEL. Request bodies cannot change the model,
 * and the only environment variable read here is the key.
 */
export const MODEL = '~anthropic/claude-haiku-latest'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Explicit cap on every call. Thinking is on and its tokens count toward this cap, so it holds the thinking
 * (a few hundred to about 500 tokens here) plus the plan JSON (a few hundred). It was 4096 with thinking off.
 */
const MAX_TOKENS = 6144

/**
 * The most one model call may take. Over 24 live plan calls with thinking off the median was 1.7 s, p95 2.6 s
 * and the slowest 4.1 s. Thinking adds up to about 500 tokens of output, roughly 4 s more at Haiku speed, so
 * a slow healthy call is about 8 s and 10 s leaves a margin. A call that hangs is cut here and, budget
 * allowing, repeated once. It was 6 s with thinking off.
 */
export const CALL_LIMIT_MS = 10_000
/** A retry after a timeout needs at least this much of the run budget left, or the failure is reported. */
const RETRY_MIN_MS = 10_000

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ModelReply {
  text: string
  finish: string | null
  /** The model that answered the try whose reply is returned. */
  model: string | null
  /** The served model of each try that replied, in order. A retried empty first reply keeps its own model here. */
  servedModels: Array<string | null>
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

const UNBILLED_STATUSES = new Set([400, 401, 402, 403, 429])
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

/**
 * Adds usage across calls. A total is reported only when every call that reported usage reported that field.
 * A call that reported nothing (a timeout, a lost connection, an HTTP error) is counted in `unreportedCalls`,
 * never guessed and never allowed to hide the figures of the calls that were billed. `unreported` adds calls
 * that are not in `parts` at all.
 */
export function sumUsage(parts: RunUsage[], unreported = 0): RunUsage {
  const isLost = (part: RunUsage) => !USAGE_KEYS.some((key) => part[key] !== undefined) && (part.unreportedCalls ?? 0) > 0
  const known = parts.filter((part) => !isLost(part))
  const out: RunUsage = {}
  if (known.length > 0) {
    for (const key of USAGE_KEYS) {
      const values = known.map((part) => part[key])
      if (values.every((value): value is number => typeof value === 'number')) {
        out[key] = values.reduce((sum, value) => sum + value, 0)
      }
    }
  }
  const lost = unreported + parts.reduce((sum, part) => sum + (part.unreportedCalls ?? 0), 0)
  if (lost > 0) out.unreportedCalls = lost
  return out
}

/** What a failed call was billed for its tries so far, carried on the error it threw. Undefined when no call was made. */
export function billedUsage(err: unknown): RunUsage | undefined {
  return typeof err === 'object' && err !== null ? (err as { billed?: RunUsage }).billed : undefined
}

function carryBilled(err: unknown, billed: RunUsage): unknown {
  if (typeof err === 'object' && err !== null) Object.assign(err, { billed })
  return err
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
    // Only message.content is read. The model's reasoning arrives in other fields and is never parsed or shown.
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
  // Every try is counted: the usage of each that replied, and how many ended with no reply at all.
  const billed: RunUsage[] = []
  let lost = 0
  const tryOnce = async (): Promise<RawReply> => {
    try {
      const raw = await requestOnce(messages, apiKey, signal)
      billed.push(raw.usage)
      return raw
    } catch (err) {
      // A request the provider refused outright (HTTP 400, 401, 402, 403, 429) was never billed: $0, not "not reported".
      if (!(err instanceof ProviderError && UNBILLED_STATUSES.has(err.status))) lost += 1
      throw err
    }
  }
  const attempt = async (): Promise<RawReply> => {
    try {
      return await tryOnce()
    } catch (err) {
      const kind = retryKind(err, signal)
      const roomLeft = options.deadlineAt === undefined || options.deadlineAt - Date.now() >= RETRY_MIN_MS
      if (!kind || retriedAfter || !roomLeft) throw err
      retriedAfter = kind
      return await tryOnce()
    }
  }

  try {
    const first = await attempt()
    if (first.text || first.finish === 'length') {
      return { ...first, usage: sumUsage(billed, lost), servedModels: [first.model], attempts: 1, retriedAfter }
    }

    // The served model is the one that answered the second try. A missing name is not filled in from the first try.
    const second = await attempt()
    return {
      text: second.text,
      finish: second.finish,
      model: second.model,
      servedModels: [first.model, second.model],
      usage: sumUsage(billed, lost),
      attempts: 2,
      retriedAfter,
    }
  } catch (err) {
    // The failure keeps what the tries before it were billed, so the run's rows and totals can show it.
    throw carryBilled(err, sumUsage(billed, lost))
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
