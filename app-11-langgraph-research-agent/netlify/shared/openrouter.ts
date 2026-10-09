import { PlainError } from './errors'
import { withLimit } from './limit'
import { isAbortError, isRecord, isTimeoutError } from './json'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Reasoning is off in every request. A reasoning-capable model would otherwise spend a small
 * output cap on hidden reasoning and return little or no text.
 */
const REASONING_OFF = { enabled: false }

/** The longest wait for one model call. The run budget can end a call sooner. */
export const MODEL_CALL_TIMEOUT_MS = 12_000

export const SLOW_MESSAGE = 'The AI provider did not answer in time.'
export const BUDGET_MESSAGE = 'The run reached its time limit before this step finished.'
export const UNREACHABLE_MESSAGE = 'Could not reach the AI provider.'
export const UNREADABLE_MESSAGE = 'The AI provider sent a reply that could not be read.'
export const NOT_CONFIGURED_MESSAGE = 'The AI provider is not configured.'

export class ProviderError extends PlainError {
  constructor(status: number, message: string) {
    super(status, message)
    this.name = 'ProviderError'
  }
}

export interface TokenUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  /** USD, reported by OpenRouter when usage accounting is on. */
  cost?: number
}

export interface ToolCall {
  id: string
  name: string
  /** The arguments exactly as the model wrote them, a JSON string. Parsed only when the tool runs. */
  args: string
}

export interface ToolDefinition {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface AssistantToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: AssistantToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  max_tokens: number
  tools?: ToolDefinition[]
  tool_choice?: 'auto' | 'required'
  response_format?: { type: 'json_object' }
}

export interface ChatReply {
  text: string
  toolCalls: ToolCall[]
  finishReason: string | null
  servedModel: string | null
  usage: TokenUsage
}

/** The model layer. Tests inject a scripted one; the function uses `chat`. */
export type ChatFn = (request: ChatRequest, signal: AbortSignal) => Promise<ChatReply>

/** True for a model call that hit its own time limit, as opposed to one cut off by the run budget. */
export function isCallTimeout(err: unknown): boolean {
  return err instanceof ProviderError && err.status === 504 && err.message === SLOW_MESSAGE
}

/** True for a call worth trying once more: it hit its own time limit, or the connection failed. */
export function isRetryable(err: unknown): boolean {
  return isCallTimeout(err) || (err instanceof ProviderError && err.status === 502 && err.message === UNREACHABLE_MESSAGE)
}

/** Plain text for an HTTP status. The provider's own body is never shown or logged. */
export function messageForStatus(status: number): string {
  if (status === 401 || status === 402 || status === 403) {
    return 'The AI provider rejected the key or is out of credit.'
  }
  if (status === 429) return 'Rate limited, try again in a minute.'
  if (status === 408 || status >= 500) return SLOW_MESSAGE
  return 'The AI provider rejected the request.'
}

/** One chat completion. Usage accounting is always on so OpenRouter reports the cost. */
export async function chat(request: ChatRequest, signal: AbortSignal): Promise<ChatReply> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new ProviderError(503, NOT_CONFIGURED_MESSAGE)

  // The whole call, body read included, ends when the run budget aborts or after the per-call limit.
  try {
    return await withLimit(signal, MODEL_CALL_TIMEOUT_MS, async (callSignal) => {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, reasoning: REASONING_OFF, usage: { include: true } }),
        signal: callSignal,
      })
      if (!response.ok) throw new ProviderError(response.status, messageForStatus(response.status))
      const text = await response.text()
      let json: unknown
      try {
        json = JSON.parse(text) as unknown
      } catch {
        throw new ProviderError(502, UNREADABLE_MESSAGE)
      }
      return parseReply(json)
    })
  } catch (err) {
    throw err instanceof ProviderError ? err : transportError(err, signal)
  }
}

/** The call's own limit raises a TimeoutError. An abort from the run signal means the run budget ended it. */
function transportError(err: unknown, runSignal: AbortSignal): ProviderError {
  if (!isAbortError(err)) return new ProviderError(502, UNREACHABLE_MESSAGE)
  return new ProviderError(504, runSignal.aborted && !isTimeoutError(err) ? BUDGET_MESSAGE : SLOW_MESSAGE)
}

/** Reads one chat completion reply. Throws ProviderError when no choice is present. */
export function parseReply(json: unknown): ChatReply {
  const body = isRecord(json) ? json : {}
  const choices: unknown[] = Array.isArray(body.choices) ? body.choices : []
  const first = isRecord(choices[0]) ? choices[0] : null
  if (!first) throw new ProviderError(502, UNREADABLE_MESSAGE)

  const message = isRecord(first.message) ? first.message : {}
  const rawCalls: unknown[] = Array.isArray(message.tool_calls) ? message.tool_calls : []
  return {
    text: typeof message.content === 'string' ? message.content.trim() : '',
    toolCalls: rawCalls.flatMap((raw) => parseToolCall(raw)),
    finishReason: typeof first.finish_reason === 'string' ? first.finish_reason : null,
    servedModel: typeof body.model === 'string' && body.model !== '' ? body.model : null,
    usage: parseUsage(body.usage),
  }
}

/** A tool call without an id or a function name cannot be answered, so it is dropped. */
function parseToolCall(raw: unknown): ToolCall[] {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isRecord(raw.function)) return []
  const fn = raw.function
  if (typeof fn.name !== 'string' || fn.name === '') return []
  const args = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {})
  return [{ id: raw.id, name: fn.name, args }]
}

function parseUsage(value: unknown): TokenUsage {
  const usage: TokenUsage = {}
  if (!isRecord(value)) return usage
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const) {
    const amount = value[key]
    if (typeof amount === 'number' && Number.isFinite(amount)) usage[key] = amount
  }
  return usage
}
