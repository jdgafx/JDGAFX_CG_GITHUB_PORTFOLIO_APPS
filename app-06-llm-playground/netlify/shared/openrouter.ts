import { errorName, isRecord, strOrNull } from './parse'

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

const UNREADABLE = 'The AI provider could not be reached or returned an unreadable reply'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  max_tokens: number
  temperature?: number
  reasoning?: { enabled: boolean }
  provider?: { require_parameters: boolean }
}

export type ChatResult =
  | { ok: true; data: Record<string, unknown>; latencyMs: number }
  | { ok: false; error: string; latencyMs: number }

// The key exists only as a Netlify environment variable. Never log or return it.
export function providerKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  return key ? key : null
}

// Plain-language summary for the browser. Raw provider bodies can name provider
// accounts, so they go to the function log only.
export function providerFailure(status: number): string {
  if (status === 402) return 'The AI provider is out of credit right now'
  if (status === 429) return 'Rate limited, try again shortly'
  if (status === 401 || status === 403) return 'The AI provider rejected the server key'
  if (status >= 500) return 'The AI provider failed'
  return `The AI provider rejected the request (status ${status})`
}

// One non-streaming chat call. usage.include makes OpenRouter report the billed cost.
export async function chat(key: string, body: ChatRequest, timeoutMs: number): Promise<ChatResult> {
  const started = Date.now()
  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, usage: { include: true } }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500)
      console.error(`Provider returned ${res.status} for ${body.model}: ${detail}`)
      return { ok: false, error: providerFailure(res.status), latencyMs: Date.now() - started }
    }
    const data: unknown = await res.json()
    if (!isRecord(data)) return { ok: false, error: UNREADABLE, latencyMs: Date.now() - started }
    return { ok: true, data, latencyMs: Date.now() - started }
  } catch (err) {
    const name = errorName(err)
    const latencyMs = Date.now() - started
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, error: `Timed out after ${Math.round(timeoutMs / 1000)} s`, latencyMs }
    }
    console.error(`Provider call failed for ${body.model}: ${name}`)
    return { ok: false, error: UNREADABLE, latencyMs }
  }
}

export function replyOf(data: Record<string, unknown>): { text: string; finishReason: string | null } {
  const choice: Record<string, unknown> = Array.isArray(data.choices) && isRecord(data.choices[0]) ? data.choices[0] : {}
  const message: Record<string, unknown> = isRecord(choice.message) ? choice.message : {}
  return { text: strOrNull(message.content) ?? '', finishReason: strOrNull(choice.finish_reason) }
}
