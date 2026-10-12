const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * One model call gets at most this long. The run budget is shared by every call in a run. With thinking
 * on, a healthy call is estimated at 0.8 s plus (500 reasoning tokens + its answer) at 130 tokens a second:
 * about 5.6 s for classify, 7 s for the duplicate judge, 5.8 s for the reply. That is derived from the
 * thinking-off measurements, not measured. The old 8 s limit sat on a 3 s p95 and would now cut healthy
 * calls, so it is 12 s: past that is a hang. Inside the 25 s budget this leaves no room to retry a hung
 * classify call (see runChat in nodes.ts); only the reply call of a resume can still be retried after a hang.
 */
export const CALL_TIMEOUT_MS = 12_000

// User-facing copy. Provider bodies, keys and raw errors never leave the server.
export const PROVIDER_NOT_CONFIGURED = 'The AI provider is not configured.'
export const PROVIDER_REJECTED = 'The AI provider rejected the key or is out of credit.'
export const PROVIDER_BUSY = 'Rate limited, try again in a minute.'
export const PROVIDER_SLOW = 'The AI provider did not answer in time.'
export const PROVIDER_TIMEOUT = `The AI provider did not answer within ${CALL_TIMEOUT_MS / 1000} seconds.`
export const PROVIDER_UNREACHABLE = 'Could not reach the AI provider.'
export const PROVIDER_REQUEST = 'The AI provider rejected the request.'
export const PROVIDER_BAD_REPLY = 'The AI provider sent a reply that could not be read.'
export const PROVIDER_CUT_OFF = 'The AI ran out of reply length before the reply was finished.'

/** What a failed call still billed: its answered result, and how many calls ended with no usage block (see ProviderError). */
export interface Billing {
  /** The reply the provider billed and the run then refused, such as one cut off at the token cap. */
  result?: ChatResult
  /** Calls that may have been billed but whose usage never arrived: a timeout, a lost connection, a 5xx, an unreadable body. */
  unreportedCalls?: number
}

/** A failed model call. The message is written for the visitor and is safe to show. */
export class ProviderError extends Error {
  /** The billed reply, when the call was answered and then refused. Its usage and cost count in the step's row and the totals. */
  readonly result?: ChatResult
  /** Calls whose usage cannot be known. Grows when a retry fails after an earlier attempt that never reported. */
  unreportedCalls: number

  /**
   * timeout: this one call passed its own limit. budget: the whole run's budget ended while the call
   * was in flight. length: the reply stopped at the token cap, so its text may be missing its tail.
   * Anything else is a failure the provider or the network reported.
   */
  constructor(
    readonly status: number,
    message: string,
    readonly kind?: 'timeout' | 'budget' | 'length',
    /** True when this is the failure of a second attempt, after one automatic retry. */
    readonly retried = false,
    billing: Billing = {},
  ) {
    super(message)
    this.name = 'ProviderError'
    this.result = billing.result
    this.unreportedCalls = billing.unreportedCalls ?? 0
  }
}

/** Maps an HTTP status from the provider to the plain message the visitor sees. */
export function providerFailure(status: number): ProviderError {
  if (status === 401 || status === 402 || status === 403) return new ProviderError(status, PROVIDER_REJECTED)
  if (status === 429) return new ProviderError(status, PROVIDER_BUSY)
  // A 5xx may have run the model before it failed, and says nothing about it. A 4xx bills nothing.
  if (status >= 500) return new ProviderError(status, PROVIDER_SLOW, undefined, false, { unreportedCalls: 1 })
  return new ProviderError(status, PROVIDER_REQUEST)
}

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  maxTokens: number
  /** Asks for a JSON object reply. */
  json?: boolean
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

function parseUsage(value: unknown): ChatUsage {
  const raw = isRecord(value) ? value : {}
  const usage: ChatUsage = {}
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const) {
    if (typeof raw[key] === 'number') usage[key] = raw[key]
  }
  return usage
}

/**
 * Reads one chat completion reply: text, finish reason, served model and usage. Pure. Only message.content
 * is the answer. The reasoning fields (message.reasoning, reasoning_details) are never read, so thinking
 * can neither be parsed as the JSON reply nor shown. A reply that spent its cap on thinking has empty content.
 */
export function parseChatReply(body: unknown): ChatResult {
  const reply = isRecord(body) ? body : {}
  const first = Array.isArray(reply.choices) && isRecord(reply.choices[0]) ? reply.choices[0] : {}
  const message = isRecord(first.message) ? first.message : {}
  return {
    text: typeof message.content === 'string' ? message.content.trim() : '',
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
    // No temperature, ever: Haiku 5.5 does not take one, and with require_parameters a request that sends
    // it fails with 404 "No endpoints found". ChatRequest has no field for it.
    usage: { include: true },
    // No reasoning field, ever: thinking stays on at Haiku's default, and max_tokens is sized for it.
    // Route only to providers that honour every parameter in the request.
    provider: { require_parameters: true },
    ...(request.json ? { response_format: { type: 'json_object' } } : {}),
  }
}

/** One request and its whole reply, body included. Failures keep the provider's own plain message. */
async function exchange(request: ChatRequest, apiKey: string, signal: AbortSignal): Promise<ChatResult> {
  let response: Response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody(request)),
      signal,
    })
  } catch {
    throw new ProviderError(0, PROVIDER_UNREACHABLE, undefined, false, { unreportedCalls: 1 })
  }
  if (!response.ok) throw providerFailure(response.status)
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderError(502, PROVIDER_BAD_REPLY, undefined, false, { unreportedCalls: 1 })
  }
  return parseChatReply(body)
}

/**
 * One chat completion. Two deadlines apply: the call's own limit, and the run's signal. Both are timers
 * that settle a race with the whole exchange, the body read included, so a reply whose body never
 * finishes is cut at the limit even if the fetch ignores its abort signal. The fetch is aborted too, to
 * free the connection. The error says which deadline ended the call.
 */
export async function chat(request: ChatRequest, signal: AbortSignal): Promise<ChatResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new ProviderError(503, PROVIDER_NOT_CONFIGURED)

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onRunAbort: (() => void) | undefined
  const deadlines = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new ProviderError(504, PROVIDER_TIMEOUT, 'timeout', false, { unreportedCalls: 1 }))
    }, CALL_TIMEOUT_MS)
    onRunAbort = () => {
      controller.abort()
      reject(new ProviderError(504, PROVIDER_SLOW, 'budget', false, { unreportedCalls: 1 }))
    }
    if (signal.aborted) onRunAbort()
    else signal.addEventListener('abort', onRunAbort, { once: true })
  })
  const reply = exchange(request, apiKey, controller.signal)
  try {
    return await Promise.race([reply, deadlines])
  } finally {
    clearTimeout(timer)
    if (onRunAbort) signal.removeEventListener('abort', onRunAbort)
    // The abandoned side may still reject later. Nothing is waiting for it.
    reply.catch(() => {})
    deadlines.catch(() => {})
  }
}
