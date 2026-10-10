import { withDeadline } from './deadline'
/** The one chat model every call in this app uses. No client field or env var overrides it. */
export const MODEL = '~anthropic/claude-haiku-latest'

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
const CATALOGUE_URL = 'https://openrouter.ai/api/v1/models'

/** Output cap sent on every model call, so no answer can run unbounded. */
const MAX_OUTPUT_TOKENS = 4096

export const TIMEOUT_MESSAGE = 'The AI provider did not answer in time.'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface RawUsage {
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  cost: number | null
}

export type AttemptOk = { ok: true; content: string; finishReason: string | null; model: string | null; usage: RawUsage }
/** `retryable` is true only when the call timed out or never connected, and the browser had not gone away. */
type Attempt = AttemptOk | { ok: false; status: number; message: string; retryable?: boolean }

// Upstream error bodies carry account identifiers. The function log keeps them;
// the browser gets one plain sentence per status.
function upstreamMessage(status: number): string {
  if (status === 401 || status === 402 || status === 403) return 'The AI provider rejected the key or is out of credit.'
  if (status === 429) return 'Rate limited, try again in a minute.'
  if (status >= 500) return TIMEOUT_MESSAGE
  return 'The AI provider rejected the request.'
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function readUsage(raw: unknown): RawUsage {
  const usage = asRecord(raw)
  return {
    prompt_tokens: numberOrNull(usage['prompt_tokens']),
    completion_tokens: numberOrNull(usage['completion_tokens']),
    total_tokens: numberOrNull(usage['total_tokens']),
    cost: numberOrNull(usage['cost']),
  }
}

/** The fields this app reads from a chat completion body. Anything else is ignored. */
function readReply(raw: unknown): { model: string | null; content: string; finishReason: string | null; usage: RawUsage } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const body = raw as Record<string, unknown>
  const choices: unknown = body['choices']
  const choice = asRecord(Array.isArray(choices) ? (choices as unknown[])[0] : undefined)
  const message = asRecord(choice['message'])
  return {
    model: typeof body['model'] === 'string' ? body['model'] : null,
    content: typeof message['content'] === 'string' ? message['content'] : '',
    finishReason: typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] : null,
    usage: readUsage(body['usage']),
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

/**
 * One chat call. `deadline` is an epoch-millisecond time shared by every call in a
 * request, so a retry gets only the time the first call left over. `signal`, when
 * given, cancels the call as well, for example when the browser has gone away.
 */
export async function callModel(apiKey: string, messages: ChatMessage[], deadline: number, signal?: AbortSignal): Promise<Attempt> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return { ok: false, status: 504, message: TIMEOUT_MESSAGE }

  // The deadline covers the body read as well as the headers, so a reply that stalls midway ends at the limit.
  type Fetched = { ok: true; raw: unknown } | { ok: false; status: number; detail: string }
  let fetched: Fetched
  try {
    fetched = await withDeadline<Fetched>(remaining, signal, async limit => {
      const response = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages,
          max_tokens: MAX_OUTPUT_TOKENS,
          reasoning: { enabled: false },
          response_format: { type: 'json_object' },
          usage: { include: true },
        }),
        signal: limit,
      })
      if (!response.ok) return { ok: false, status: response.status, detail: await response.text().catch(() => '') }
      // A body that is not JSON reads as an unreadable reply. A body cut off by the deadline propagates as a timeout.
      const raw: unknown = await response.json().catch((err: unknown) => {
        if (isTimeout(err)) throw err
        return null
      })
      return { ok: true, raw }
    })
  } catch (err) {
    console.error('OpenRouter request failed:', err instanceof Error ? err.name : 'non-error')
    const retryable = signal?.aborted !== true
    return isTimeout(err)
      ? { ok: false, status: 504, message: TIMEOUT_MESSAGE, retryable }
      : { ok: false, status: 502, message: 'Could not reach the AI provider. Try again shortly.', retryable }
  }

  if (!fetched.ok) {
    console.error('OpenRouter error:', fetched.status, fetched.detail)
    // A provider rate limit is passed on as 429. Other provider failures are a 502 from this function.
    return { ok: false, status: fetched.status === 429 ? 429 : 502, message: upstreamMessage(fetched.status) }
  }

  const reply = readReply(fetched.raw)
  if (!reply) return { ok: false, status: 502, message: 'The AI provider returned an unreadable response.' }
  return { ok: true, content: reply.content, finishReason: reply.finishReason, model: reply.model, usage: reply.usage }
}

// Catalogue pricing is public and changes rarely, so one lookup per instance
// per hour is enough. Only used when the provider does not report a cost.
const CATALOGUE_TTL_MS = 60 * 60 * 1000
const CATALOGUE_MAX_MS = 4000
const CATALOGUE_MIN_MS = 1000

interface Price {
  prompt: number
  completion: number
}

let catalogue: { loadedAt: number; prices: Map<string, Price> } | null = null

// Prices arrive as strings in USD per token. Anything else is not a price.
function perToken(value: unknown): number {
  return typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
}

async function loadPrices(deadline: number): Promise<Map<string, Price> | null> {
  if (catalogue && Date.now() - catalogue.loadedAt < CATALOGUE_TTL_MS) return catalogue.prices
  const remaining = deadline - Date.now()
  if (remaining < CATALOGUE_MIN_MS) return null
  try {
    const body = await withDeadline(Math.min(CATALOGUE_MAX_MS, remaining), undefined, async limit => {
      const response = await fetch(CATALOGUE_URL, { signal: limit })
      if (!response.ok) return null
      return asRecord(await response.json().catch(() => null))
    })
    if (!body) return null
    const data: unknown = body['data']
    // Anything other than a list is not cached, so one bad reply cannot hide prices for an hour.
    if (!Array.isArray(data)) return null
    const prices = new Map<string, Price>()
    for (const item of data as unknown[]) {
      const entry = asRecord(item)
      const pricing = asRecord(entry['pricing'])
      const prompt = perToken(pricing['prompt'])
      const completion = perToken(pricing['completion'])
      if (typeof entry['id'] === 'string' && prompt >= 0 && completion >= 0) {
        prices.set(entry['id'], { prompt, completion })
      }
    }
    catalogue = { loadedAt: Date.now(), prices }
    return prices
  } catch (err) {
    console.error('OpenRouter catalogue lookup failed:', err instanceof Error ? err.name : 'non-error')
    return null
  }
}

/**
 * USD cost from catalogue pricing and token counts. Null when the model has no listed
 * price, or when the request has too little time left to fetch the catalogue.
 */
export async function estimateCost(model: string, promptTokens: number, completionTokens: number, deadline: number): Promise<number | null> {
  const price = (await loadPrices(deadline))?.get(model)
  if (!price) return null
  return promptTokens * price.prompt + completionTokens * price.completion
}
