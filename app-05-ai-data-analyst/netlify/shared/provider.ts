/**
 * The one module that calls the model. Every chat or text call goes through
 * callModel(), which always sends MODEL. Request bodies cannot change the model,
 * and no environment variable other than the key and endpoint is read here.
 */
export const MODEL = '~anthropic/claude-haiku-latest'

const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/** Explicit cap on every call. With reasoning off, the whole budget goes to the visible JSON. */
const MAX_TOKENS = 4096

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ModelUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  /** USD, as reported by OpenRouter. Absent when the provider does not report it. */
  cost?: number
}

export interface ModelReply {
  text: string
  finish: string | null
  model: string | null
  usage: ModelUsage
  attempts: number
}

export interface Failure {
  status: number
  message: string
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

function readUsage(raw: unknown): ModelUsage {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out: ModelUsage = {}
  for (const key of USAGE_KEYS) {
    const value = data[key]
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

/** Adds usage across calls. A total is reported only when every call reported that field. */
export function sumUsage(parts: ModelUsage[]): ModelUsage {
  if (parts.length === 0) return {}
  const out: ModelUsage = {}
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
  usage: ModelUsage
}

async function requestOnce(messages: ChatMessage[], apiKey: string, signal: AbortSignal): Promise<RawReply> {
  const response = await fetch(process.env.OPENROUTER_URL ?? DEFAULT_ENDPOINT, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      reasoning: { enabled: false },
      response_format: { type: 'json_object' },
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

/**
 * One chat call. An empty reply gets one more attempt. A cut-off reply does not,
 * because the same prompt would be cut off again; the caller reports it instead.
 */
export async function callModel(messages: ChatMessage[], signal: AbortSignal): Promise<ModelReply> {
  const apiKey = getApiKey()
  if (!apiKey) throw new ProviderError(401)

  const first = await requestOnce(messages, apiKey, signal)
  if (first.text || first.finish === 'length') return { ...first, attempts: 1 }

  const second = await requestOnce(messages, apiKey, signal)
  return {
    text: second.text,
    finish: second.finish,
    model: second.model ?? first.model,
    usage: sumUsage([first.usage, second.usage]),
    attempts: 2,
  }
}

/** Maps a failed model call to our HTTP status and a plain-language message. Never the raw body. */
export function describeFailure(err: unknown): Failure {
  if (err instanceof ProviderError) {
    if (err.status === 402) {
      return { status: 502, message: 'The AI provider is out of credit, so this analysis cannot run right now.' }
    }
    if (err.status === 429) {
      return { status: 429, message: 'The AI provider is rate limited right now. Try again in a moment.' }
    }
    if (err.status === 401 || err.status === 403) {
      return { status: 502, message: 'The AI provider rejected the server credentials.' }
    }
    if (err.status >= 500) {
      return { status: 502, message: 'The AI provider failed. Try again in a moment.' }
    }
    return { status: 502, message: 'The AI provider rejected the request.' }
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return { status: 504, message: 'The analysis took too long and was stopped. Try a simpler question.' }
  }
  return { status: 502, message: 'Could not reach the AI provider. Try again.' }
}
