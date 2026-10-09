import { withDeadline } from './deadline'
import { OPENROUTER_CHAT_URL, type ProviderReply } from './provider'

// User-facing copy. Provider bodies, keys and raw errors never leave the server.
const PROVIDER_REJECTED = 'The AI provider rejected the key or is out of credit.'
const PROVIDER_BUSY = 'Rate limited, try again in a minute.'
export const PROVIDER_SLOW = 'The AI provider did not answer in time.'

export type Attempt =
  | { ok: true; reply: ProviderReply }
  | {
      ok: false
      status: number
      detail: string
      message: string
      headers?: Record<string, string>
      /** True for a timeout or a lost connection: the only failures worth one more try. 4xx, 429 and 5xx never are. */
      retryable: boolean
    }

function providerFailure(status: number): Attempt {
  const base = { ok: false, retryable: false } as const
  if (status === 401 || status === 402 || status === 403) {
    return { ...base, status: 502, detail: `Key rejected or out of credit (HTTP ${status})`, message: PROVIDER_REJECTED }
  }
  if (status === 429) {
    return { ...base, status: 429, detail: 'Rate limited (HTTP 429)', message: PROVIDER_BUSY, headers: { 'Retry-After': '60' } }
  }
  if (status >= 500) return { ...base, status: 502, detail: `Provider failed (HTTP ${status})`, message: PROVIDER_SLOW }
  return { ...base, status: 502, detail: `Request rejected (HTTP ${status})`, message: 'The AI provider rejected the request.' }
}

/** One chat completion with its own hard limit. The body read is inside the limit, so a stalled body cannot outlive it. */
export async function callModel(apiKey: string, body: string, limitMs: number): Promise<Attempt> {
  try {
    return await withDeadline(limitMs, undefined, async (signal): Promise<Attempt> => {
      const response = await fetch(OPENROUTER_CHAT_URL, {
        method: 'POST',
        signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
      })
      if (!response.ok) return providerFailure(response.status)
      return { ok: true, reply: (await response.json()) as ProviderReply }
    })
  } catch (err) {
    const name = (err as { name?: unknown } | null)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      return {
        ok: false,
        status: 504,
        detail: `No answer within ${(limitMs / 1000).toFixed(1)} s`,
        message: PROVIDER_SLOW,
        retryable: true,
      }
    }
    if (err instanceof SyntaxError) {
      return {
        ok: false,
        status: 502,
        detail: 'Reply was not JSON',
        message: 'The AI service is unavailable right now. Try again in a moment.',
        retryable: false,
      }
    }
    console.error('CodeLens: provider call failed', err)
    return {
      ok: false,
      status: 502,
      detail: 'Could not reach the provider',
      message: 'Could not reach the AI provider. Try again in a moment.',
      retryable: true,
    }
  }
}
