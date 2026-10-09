import { withDeadline } from './deadline'
import { errorName, isRecord, strOrNull } from './parse'

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

const UNREADABLE = 'The AI provider could not be reached or returned an unreadable reply'
const NO_ANSWER = 'The AI provider did not answer in time'
const STOPPED = 'The request was stopped before the AI provider answered'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

interface ChatRequest {
  model: string
  messages: ChatMessage[]
  max_tokens: number
  temperature?: number
  reasoning?: { enabled: boolean }
}

interface ChatLimits {
  timeoutMs: number
  signal?: AbortSignal
}

// retryable: the failure was a timeout or a lost connection, which a second try can fix. A refusal
// (401, 402, 429, 5xx), an unreadable reply and a stop are never retried.
export type ChatResult =
  | { ok: true; data: Record<string, unknown>; latencyMs: number }
  | { ok: false; error: string; latencyMs: number; retryable?: boolean }

// The key exists only as a Netlify environment variable. Never log or return it.
export function providerKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  return key ? key : null
}

// Plain-language summary for the browser. Raw provider bodies can name provider
// accounts, so they go to the function log only.
function providerFailure(status: number): string {
  if (status === 401 || status === 402) return 'The AI provider rejected the key or is out of credit'
  if (status === 429) return 'Rate limited, try again in a minute'
  if (status >= 500) return NO_ANSWER
  return `The AI provider rejected the request (status ${status})`
}

// One non-streaming chat call. usage.include makes OpenRouter report the billed cost.
// A caller that stopped while the call was pending gets the stop message, even when the provider
// answers late: the stop wins over the reply.
export async function chat(key: string, body: ChatRequest, limits: ChatLimits): Promise<ChatResult> {
  const started = Date.now()
  const stopped = (): ChatResult => ({ ok: false, error: STOPPED, latencyMs: Date.now() - started })
  try {
    // The deadline covers the body read as well as the headers: a reply that stalls midway still ends at the limit.
    const outcome = await withDeadline(Math.max(0, limits.timeoutMs), limits.signal, async signal => {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, usage: { include: true } }),
        signal,
      })
      if (!res.ok) return { ok: false as const, status: res.status, detail: (await res.text()).slice(0, 500) }
      return { ok: true as const, data: (await res.json()) as unknown }
    })
    if (limits.signal?.aborted) return stopped()
    if (!outcome.ok) {
      console.error(`Provider returned ${outcome.status} for ${body.model}: ${outcome.detail}`)
      return { ok: false, error: providerFailure(outcome.status), latencyMs: Date.now() - started }
    }
    const data = outcome.data
    if (!isRecord(data)) return { ok: false, error: UNREADABLE, latencyMs: Date.now() - started }
    return { ok: true, data, latencyMs: Date.now() - started }
  } catch (err) {
    if (limits.signal?.aborted) return stopped()
    const name = errorName(err)
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, error: NO_ANSWER, latencyMs: Date.now() - started, retryable: true }
    }
    console.error(`Provider call failed for ${body.model}: ${name}`)
    return { ok: false, error: UNREADABLE, latencyMs: Date.now() - started, retryable: true }
  }
}

export function replyOf(data: Record<string, unknown>): { text: string; finishReason: string | null } {
  const choice: Record<string, unknown> = Array.isArray(data.choices) && isRecord(data.choices[0]) ? data.choices[0] : {}
  const message: Record<string, unknown> = isRecord(choice.message) ? choice.message : {}
  return { text: strOrNull(message.content) ?? '', finishReason: strOrNull(choice.finish_reason) }
}
