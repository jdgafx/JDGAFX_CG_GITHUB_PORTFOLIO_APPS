/** The one chat model every call in this app uses. No client field or env var overrides it. */
export const MODEL = '~anthropic/claude-haiku-latest'

/** Output cap sent on every model call, so no answer can run unbounded. */
export const MAX_OUTPUT_TOKENS = 4096

export interface ProviderConfig {
  url: string
  apiKey: string
  model: string
}

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
export type Attempt = AttemptOk | { ok: false; status: number; message: string }

/** The provider for the given model, or null when no OpenRouter key is configured. */
export function getProvider(model: string): ProviderConfig | null {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  return {
    url: process.env.OPENROUTER_URL ?? 'https://openrouter.ai/api/v1/chat/completions',
    apiKey,
    model,
  }
}

// Upstream error bodies carry account identifiers. The function log keeps them;
// the browser gets one plain sentence per status.
function upstreamMessage(status: number): string {
  if (status === 401 || status === 403) return 'The AI provider rejected the API key.'
  if (status === 402) return 'The AI provider is out of credit for this demo.'
  if (status === 429) return 'The AI provider is rate limiting requests. Try again shortly.'
  if (status >= 500) return 'The AI provider failed. Try again shortly.'
  return 'The AI provider rejected the request.'
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readUsage(raw: unknown): RawUsage {
  const usage = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    prompt_tokens: numberOrNull(usage['prompt_tokens']),
    completion_tokens: numberOrNull(usage['completion_tokens']),
    total_tokens: numberOrNull(usage['total_tokens']),
    cost: numberOrNull(usage['cost']),
  }
}

interface ProviderBody {
  model?: unknown
  usage?: unknown
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown } | undefined>
}

/**
 * One chat call. `deadline` is shared across attempts, so a retry gets only the
 * time the first call left over rather than a fresh full timeout.
 */
export async function callModel(provider: ProviderConfig, messages: ChatMessage[], deadline: number): Promise<Attempt> {
  let response: Response
  try {
    response = await fetch(provider.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.model,
        messages,
        max_tokens: MAX_OUTPUT_TOKENS,
        reasoning: { enabled: false },
        response_format: { type: 'json_object' },
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
    })
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    console.error('OpenRouter request failed:', err)
    return timedOut
      ? { ok: false, status: 504, message: 'The model took too long to answer. Try a shorter question.' }
      : { ok: false, status: 502, message: 'Could not reach the model provider. Try again shortly.' }
  }

  if (!response.ok) {
    console.error('OpenRouter error:', response.status, await response.text().catch(() => ''))
    return { ok: false, status: 502, message: upstreamMessage(response.status) }
  }

  const body = (await response.json().catch(() => null)) as ProviderBody | null
  if (!body) return { ok: false, status: 502, message: 'The model provider returned an unreadable response.' }

  const first = body.choices?.[0]
  const content = first?.message?.content
  const finishReason = first?.finish_reason
  return {
    ok: true,
    content: typeof content === 'string' ? content : '',
    finishReason: typeof finishReason === 'string' ? finishReason : null,
    model: typeof body.model === 'string' ? body.model : null,
    usage: readUsage(body.usage),
  }
}

// Catalogue pricing is public and changes rarely, so one lookup per instance
// per hour is enough. Only used when the provider does not report a cost.
const CATALOGUE_URL = 'https://openrouter.ai/api/v1/models'
const CATALOGUE_TTL_MS = 60 * 60 * 1000

interface Price {
  prompt: number
  completion: number
}

let catalogue: { loadedAt: number; prices: Map<string, Price> } | null = null

// Prices arrive as strings in USD per token. Anything else is not a price.
function perToken(value: unknown): number {
  return typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
}

async function loadPrices(): Promise<Map<string, Price> | null> {
  if (catalogue && Date.now() - catalogue.loadedAt < CATALOGUE_TTL_MS) return catalogue.prices
  try {
    const response = await fetch(CATALOGUE_URL, { signal: AbortSignal.timeout(4000) })
    if (!response.ok) return null
    const body = (await response.json()) as {
      data?: Array<{ id?: unknown; pricing?: { prompt?: unknown; completion?: unknown } } | undefined>
    }
    const prices = new Map<string, Price>()
    for (const entry of body.data ?? []) {
      const prompt = perToken(entry?.pricing?.prompt)
      const completion = perToken(entry?.pricing?.completion)
      if (typeof entry?.id === 'string' && prompt >= 0 && completion >= 0) {
        prices.set(entry.id, { prompt, completion })
      }
    }
    catalogue = { loadedAt: Date.now(), prices }
    return prices
  } catch (err) {
    console.error('OpenRouter catalogue lookup failed:', err)
    return null
  }
}

/** USD cost from catalogue pricing and token counts, or null if the model has no listed price. */
export async function estimateCost(model: string, promptTokens: number, completionTokens: number): Promise<number | null> {
  const price = (await loadPrices())?.get(model)
  if (!price) return null
  return promptTokens * price.prompt + completionTokens * price.completion
}
