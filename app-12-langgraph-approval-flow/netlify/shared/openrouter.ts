const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/** One model call gets at most this long. The run budget is shared by every call in a run. */
export const CALL_TIMEOUT_MS = 12_000

// User-facing copy. Provider bodies, keys and raw errors never leave the server.
export const PROVIDER_NOT_CONFIGURED = 'The AI provider is not configured.'
export const PROVIDER_REJECTED = 'The AI provider rejected the key or is out of credit.'
export const PROVIDER_BUSY = 'Rate limited, try again in a minute.'
export const PROVIDER_SLOW = 'The AI provider did not answer in time.'
export const PROVIDER_UNREACHABLE = 'Could not reach the AI provider.'
export const PROVIDER_REQUEST = 'The AI provider rejected the request.'
export const PROVIDER_BAD_REPLY = 'The AI provider sent a reply that could not be read.'

/** A failed model call. The message is written for the visitor and is safe to show. */
export class ProviderError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}

/** Maps an HTTP status from the provider to the plain message the visitor sees. */
export function providerFailure(status: number): ProviderError {
  if (status === 401 || status === 402 || status === 403) return new ProviderError(status, PROVIDER_REJECTED)
  if (status === 429) return new ProviderError(status, PROVIDER_BUSY)
  if (status >= 500) return new ProviderError(status, PROVIDER_SLOW)
  return new ProviderError(status, PROVIDER_REQUEST)
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface ToolSpec {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  maxTokens: number
  temperature?: number
  /** Asks for a JSON object reply. */
  json?: boolean
  /** Routes only to providers that accept every parameter in the request. Defaults to true; intake turns it off. */
  requireParameters?: boolean
  tools?: ToolSpec[]
  toolChoice?: 'auto' | 'none' | 'required'
}

export interface ToolCall {
  id: string
  name: string
  /** The parsed arguments, or null when they were not valid JSON. */
  args: unknown
}

/** Only the fields the provider actually reported. A missing field stays undefined. */
export interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  /** USD, as OpenRouter reports it when usage accounting is on. */
  cost?: number
}

export interface ChatResult {
  text: string
  toolCalls: ToolCall[]
  finishReason: string | null
  /** The model the provider says answered. Undefined when the reply does not name one. */
  servedModel?: string
  usage: ChatUsage
}

/** The chat function the graph receives. Tests pass a mock in its place. */
export type ChatFn = (request: ChatRequest, signal: AbortSignal) => Promise<ChatResult>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseArgs(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function parseToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return []
  const calls: ToolCall[] = []
  for (const entry of value) {
    if (!isRecord(entry) || !isRecord(entry.function) || typeof entry.function.name !== 'string') continue
    calls.push({
      id: typeof entry.id === 'string' ? entry.id : '',
      name: entry.function.name,
      args: parseArgs(entry.function.arguments),
    })
  }
  return calls
}

function parseUsage(value: unknown): ChatUsage {
  const raw = isRecord(value) ? value : {}
  const usage: ChatUsage = {}
  if (typeof raw.prompt_tokens === 'number') usage.prompt_tokens = raw.prompt_tokens
  if (typeof raw.completion_tokens === 'number') usage.completion_tokens = raw.completion_tokens
  if (typeof raw.total_tokens === 'number') usage.total_tokens = raw.total_tokens
  if (typeof raw.cost === 'number') usage.cost = raw.cost
  return usage
}

/** Reads one chat completion reply: text, tool calls, finish reason, served model and usage. Pure. */
export function parseChatReply(body: unknown): ChatResult {
  const reply = isRecord(body) ? body : {}
  const first = Array.isArray(reply.choices) && isRecord(reply.choices[0]) ? reply.choices[0] : {}
  const message = isRecord(first.message) ? first.message : {}
  return {
    text: typeof message.content === 'string' ? message.content.trim() : '',
    toolCalls: parseToolCalls(message.tool_calls),
    finishReason: typeof first.finish_reason === 'string' ? first.finish_reason : null,
    servedModel: typeof reply.model === 'string' && reply.model !== '' ? reply.model : undefined,
    usage: parseUsage(reply.usage),
  }
}

/** The JSON body sent to OpenRouter. max_tokens is always set and usage accounting is always on. */
export function requestBody(request: ChatRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: request.messages,
    max_tokens: request.maxTokens,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    usage: { include: true },
    // Reasoning off, so a reasoning model cannot spend the output budget before the answer.
    reasoning: { enabled: false },
    // Route only to providers that honour every parameter in the request, unless the call opts out.
    ...(request.requireParameters === false ? {} : { provider: { require_parameters: true } }),
    ...(request.json ? { response_format: { type: 'json_object' } } : {}),
    ...(request.tools ? { tools: request.tools, tool_choice: request.toolChoice ?? 'auto' } : {}),
  }
}

/**
 * One chat completion. The run's signal cancels the call. The call's own 12 s timeout is added
 * on top, so a stalled provider cannot hold the run past its budget.
 */
export async function chat(request: ChatRequest, signal: AbortSignal): Promise<ChatResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new ProviderError(503, PROVIDER_NOT_CONFIGURED)

  const controller = new AbortController()
  let timedOut = false
  const onRunAbort = () => controller.abort()
  signal.addEventListener('abort', onRunAbort, { once: true })
  if (signal.aborted) controller.abort()
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, CALL_TIMEOUT_MS)

  try {
    let response: Response
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(request)),
        signal: controller.signal,
      })
    } catch {
      if (timedOut || signal.aborted) throw new ProviderError(504, PROVIDER_SLOW)
      throw new ProviderError(0, PROVIDER_UNREACHABLE)
    }
    if (!response.ok) throw providerFailure(response.status)
    let body: unknown
    try {
      body = await response.json()
    } catch {
      if (timedOut || signal.aborted) throw new ProviderError(504, PROVIDER_SLOW)
      throw new ProviderError(502, PROVIDER_BAD_REPLY)
    }
    return parseChatReply(body)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onRunAbort)
  }
}
