import { chat, type ChatResult } from './openrouter'

// A healthy call finishes well inside ATTEMPT_MS. About 2 to 3 percent of Haiku calls hang instead,
// so the first try is capped and a second one runs when the request budget still has room for it.
export const ATTEMPT_MS = 12_000
// Panels B and C run whatever model the visitor picked, and healthy ones take longer (a Gemini flash-lite model
// measured 10.6 s, a Qwen flash model 18 s), so their first try gets more room.
export const ATTEMPT_OTHER_MS = 16_000
// Below this much budget a second try cannot finish, so the first failure stands.
export const MIN_RETRY_MS = 5_000

type ChatBody = Parameters<typeof chat>[1]

export type RetriedChat = ChatResult & { retried: boolean }

interface RetryLimits {
  /** What is left of the request budget for this call, first try and second together. */
  budgetMs: number
  /** Cap on the first try. Slower models can be given a longer one. */
  attemptMs?: number
  signal?: AbortSignal
}

/**
 * One chat call with at most one automatic retry. The retry happens only after a timeout or a lost
 * connection, only when at least MIN_RETRY_MS of the budget is left, and never after a stop or a
 * refusal from the provider (4xx, 429, 5xx).
 */
export async function chatWithRetry(key: string, body: ChatBody, limits: RetryLimits): Promise<RetriedChat> {
  const started = Date.now()
  const budget = Math.max(0, limits.budgetMs)
  const first = Math.min(limits.attemptMs ?? ATTEMPT_MS, budget)
  const one = await chat(key, body, { timeoutMs: first, signal: limits.signal })
  if (one.ok || !one.retryable || limits.signal?.aborted) return { ...one, retried: false }
  const left = budget - (Date.now() - started)
  if (left < MIN_RETRY_MS) return { ...one, retried: false }
  const two = await chat(key, body, { timeoutMs: left, signal: limits.signal })
  // The reported latency covers both tries: it is what the visitor waited.
  return { ...two, latencyMs: Date.now() - started, retried: true }
}
