import { z } from 'zod'
import type { Usage } from '../../src/types/frames'
import { ProviderError, RunBudgetError, type ProviderKind } from './errors'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Each model call times out after this long unless its role sets a shorter limit (the synthesis call uses this one).
 * Synthesis was 4.1 s at the median and 7.0 s at the 95th percentile with thinking off, so about 6.6 s and 9.5 s with
 * thinking: 12 s clears the 95th percentile. The run budget is the outer limit.
 */
export const CALL_TIMEOUT_MS = 12_000

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  maxTokens: number
  /** Ask for a JSON object. Off for extract and check, whose replies are read tolerantly. */
  jsonMode: boolean
  /** Route only to providers that accept every parameter in the request. Set for synthesis only. */
  requireParameters?: boolean
  /** Ends this call after this long instead of the default. Never sent to the provider. */
  timeoutMs?: number
}

export interface ChatReply {
  text: string
  finishReason: string | null
  /** The model OpenRouter says actually answered, which can differ from the one requested. */
  servedModel: string | null
  /** Token counts as OpenRouter reports them, or null when the reply carried none. */
  usage: Usage | null
}

/** The model call the graph nodes use. The signal ends the call when the run stops. */
export type ChatFn = (request: ChatRequest, signal: AbortSignal) => Promise<ChatReply>

/** A content block, for a provider that answers with blocks instead of one string. Only text blocks are output. */
const contentPart = z.object({ type: z.string().optional(), text: z.string().nullish() })

/** The output text of a message: the string, or the text blocks joined. Thinking blocks and reasoning fields are never output. */
function contentText(content: string | z.infer<typeof contentPart>[] | null | undefined): string {
  if (typeof content === 'string') return content
  if (!content) return ''
  return content.filter((part) => part.type === 'text' && part.text).map((part) => part.text).join('')
}

const replySchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.union([z.string(), z.array(contentPart)]).nullish() }).nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .nullish(),
})

/** Reads one chat-completions reply. Only message.content is read: reasoning fields beside it are ignored, so thinking is never parsed as output. Anything unreadable becomes an empty text, which callers treat as a miss. */
export function parseReply(payload: unknown): ChatReply {
  const parsed = replySchema.safeParse(payload)
  if (!parsed.success) return { text: '', finishReason: null, servedModel: null, usage: null }
  const data = parsed.data
  const choice = data.choices?.[0]
  const usage: Usage = {}
  if (data.usage?.prompt_tokens !== undefined) usage.prompt_tokens = data.usage.prompt_tokens
  if (data.usage?.completion_tokens !== undefined) usage.completion_tokens = data.usage.completion_tokens
  if (data.usage?.total_tokens !== undefined) usage.total_tokens = data.usage.total_tokens
  return {
    text: contentText(choice?.message?.content).trim(),
    finishReason: choice?.finish_reason ?? null,
    servedModel: data.model ?? null,
    usage: Object.keys(usage).length > 0 ? usage : null,
  }
}

/** Maps an HTTP status from the provider to the failure kind the app reports. */
export function kindForStatus(status: number): ProviderKind {
  if (status === 401 || status === 402 || status === 403) return 'rejected'
  if (status === 429) return 'rate_limited'
  if (status === 408) return 'timeout'
  if (status >= 500) return 'unavailable'
  return 'bad_request'
}

/** Usage accounting is always requested, so every reply carries its token counts. The other options are sent only when a role sets them. No reasoning option is ever sent, so the model thinks by its default. */
function requestBody(request: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    max_tokens: request.maxTokens,
    usage: { include: true },
  }
  if (request.requireParameters) body.provider = { require_parameters: true }
  if (request.jsonMode) body.response_format = { type: 'json_object' }
  return body
}

/**
 * One chat call. The key is read here and nowhere else. The call has a deadline that does not depend on how
 * fetch handles an abort: a plain timer, held until the call settles, aborts the request and also rejects a
 * promise that the whole call (the request and the reading of its body) is raced against. A hung request, a
 * body that never finishes, or a fetch that ignores its signal is therefore cut at the limit, and a slow
 * reply that arrives after the limit is dropped. The run's signal ends the call the same way when the budget
 * runs out or another call halts the run. The provider body is never read into an error, logged or returned.
 */
export async function chat(
  request: ChatRequest,
  signal: AbortSignal,
  timeoutMs: number = CALL_TIMEOUT_MS,
): Promise<ChatReply> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new ProviderError('rejected')
  if (signal.aborted) throw new RunBudgetError()

  const call = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let forward: (() => void) | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      call.abort()
      reject(new ProviderError('timeout'))
    }, request.timeoutMs ?? timeoutMs)
    forward = () => {
      call.abort()
      reject(new RunBudgetError())
    }
    signal.addEventListener('abort', forward, { once: true })
  })

  const send = async (): Promise<ChatReply> => {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: call.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody(request)),
    })
    if (!response.ok) throw new ProviderError(kindForStatus(response.status))
    return parseReply(await response.json())
  }

  try {
    return await Promise.race([send(), deadline])
  } catch (err) {
    if (err instanceof ProviderError || err instanceof RunBudgetError) throw err
    if (signal.aborted) throw new RunBudgetError()
    if (err instanceof SyntaxError) throw new ProviderError('unavailable')
    throw new ProviderError('network')
  } finally {
    clearTimeout(timer)
    if (forward) signal.removeEventListener('abort', forward)
  }
}
