import { withDeadline } from './deadline'

/** The alias only; a pinned model id is forbidden (the newest model is looked up and compared, never requested). */
export const MODEL = '~anthropic/claude-haiku-latest'
export const MAX_TOKENS = 6000
export const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
/** OpenRouter's public model list. It needs no key. The alias entry names the model it resolves to today. */
export const MODEL_LIST_URL = 'https://openrouter.ai/api/v1/models'
/** Under the observed 30 s platform cut-off (spec section 1), so a runaway call ends as a timeout. */
export const MODEL_TIMEOUT_MS = 26_000
export const LIST_TIMEOUT_MS = 3_000
export const LIST_CACHE_MS = 60 * 60 * 1000
/** Identifies this portfolio app to the services it calls. It names the project, never a person. */
export const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'

export interface ChatBody {
  model: typeof MODEL
  reasoning: { effort: 'medium' }
  provider: { require_parameters: true }
  response_format: { type: 'json_schema'; json_schema: { name: 'explanation'; strict: true; schema: object } }
  max_tokens: number
  usage: { include: true }
  messages: Array<{ role: 'system' | 'user'; content: string }>
}

/**
 * The request body of spec section 3. Thinking stays on at the model's default effort, stated explicitly and
 * never capped. No temperature, no tools.
 */
export function buildChatBody(system: string, user: string, schema: object): ChatBody {
  return {
    model: MODEL,
    reasoning: { effort: 'medium' },
    provider: { require_parameters: true },
    response_format: { type: 'json_schema', json_schema: { name: 'explanation', strict: true, schema } },
    max_tokens: MAX_TOKENS,
    usage: { include: true },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  }
}

export interface ModelReply {
  content: string | null
  finish: string | null
  /** The model id the provider says answered (the reply's `model`). */
  model: string | null
  promptTokens: number | null
  completionTokens: number | null
  reasoningTokens: number | null
  /** OpenRouter's own cost for the call in USD (`usage.cost`, present because the body asks for usage accounting). */
  reportedCost: number | null
}

/** The provider answered with an error status. The key and the body are never kept. */
export class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`The AI provider answered HTTP ${status}.`)
    this.name = 'UpstreamError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** One chat call, fetch and body read both inside the 26 s limit. Throws on a bad status, a network error or the timeout. */
export function callModel(body: ChatBody, apiKey: string): Promise<ModelReply> {
  return withDeadline(MODEL_TIMEOUT_MS, async (signal) => {
    const response = await fetch(CHAT_URL, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new UpstreamError(response.status)
    const data = (await response.json()) as unknown
    const root = isRecord(data) ? data : {}
    const choice = Array.isArray(root.choices) && isRecord(root.choices[0]) ? root.choices[0] : {}
    const message = isRecord(choice.message) ? choice.message : {}
    const usage = isRecord(root.usage) ? root.usage : {}
    const details = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {}
    return {
      content: typeof message.content === 'string' ? message.content : null,
      finish: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
      model: typeof root.model === 'string' ? root.model : null,
      promptTokens: num(usage.prompt_tokens),
      completionTokens: num(usage.completion_tokens),
      reasoningTokens: num(details.reasoning_tokens),
      reportedCost: num(usage.cost),
    }
  })
}

/** USD per token, as the list states it. */
export interface ListPrice { inPerToken: number; outPerToken: number }
export interface ModelList {
  /** The alias entry's alias_target.slug, or null when the list does not name it. */
  newest: string | null
  prices: ReadonlyMap<string, ListPrice>
}

/** A rate the list states as a string. Empty, negative (router entries use -1) and non-numeric rates are not prices. */
function rate(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

/** Reads the list's JSON. Null when it is not a list of models. */
export function parseModelList(json: unknown): ModelList | null {
  if (!isRecord(json) || !Array.isArray(json.data)) return null
  const prices = new Map<string, ListPrice>()
  let newest: string | null = null
  for (const entry of json.data as unknown[]) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue
    if (entry.id === MODEL && isRecord(entry.alias_target) && typeof entry.alias_target.slug === 'string' && entry.alias_target.slug !== '') {
      newest = entry.alias_target.slug
    }
    const pricing = isRecord(entry.pricing) ? entry.pricing : {}
    const inPerToken = rate(pricing.prompt)
    const outPerToken = rate(pricing.completion)
    if (inPerToken !== null && outPerToken !== null) prices.set(entry.id, { inPerToken, outPerToken })
  }
  return { newest, prices }
}

/** One fetch of the list, 3 s at most. Any failure, bad status, timeout or unreadable JSON gives null. */
async function fetchModelList(): Promise<ModelList | null> {
  try {
    return await withDeadline(LIST_TIMEOUT_MS, async (signal) => {
      const response = await fetch(MODEL_LIST_URL, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal })
      if (!response.ok) return null
      return parseModelList((await response.json()) as unknown)
    })
  } catch {
    return null
  }
}

export type ModelListSource = () => Promise<ModelList | null>

/**
 * A source that keeps a list answer for an hour, but only one that named the newest model, so a list without the
 * entry is asked again on the next call. Callers that arrive together share one fetch. It never throws.
 */
export function createModelList(load: () => Promise<ModelList | null> = fetchModelList, now: () => number = Date.now): ModelListSource {
  let kept: { list: ModelList; at: number } | null = null
  let pending: Promise<ModelList | null> | null = null
  return () => {
    if (kept && now() - kept.at < LIST_CACHE_MS) return Promise.resolve(kept.list)
    pending ??= load()
      .then((list) => {
        if (list && list.newest !== null) kept = { list, at: now() }
        return list
      })
      .finally(() => {
        pending = null
      })
    return pending
  }
}

/** The list for the running function instance. */
export const liveModelList: ModelListSource = createModelList()

/**
 * The cost of one call when OpenRouter did not report it (`usage.cost` is the first choice, see `costOf`): its tokens times the list price of the model that answered. The provider's completion
 * count already includes reasoning, so reasoning is not added again. Null, never a guess, when the list, the
 * served model, its price or a token count is missing.
 */
export function costFor(list: ModelList | null, served: string | null, promptTokens: number | null, completionTokens: number | null): number | null {
  const price = list && served !== null ? list.prices.get(served) : undefined
  if (!price || promptTokens === null || completionTokens === null) return null
  return Math.round((promptTokens * price.inPerToken + completionTokens * price.outPerToken) * 1e12) / 1e12
}

/**
 * The cost of one call in USD. OpenRouter's own reported figure (`usage.cost`) is what the portfolio counts as
 * spend, so it comes first. Only when the reply carries none does the list price times the token counts stand in.
 */
export function costOf(reply: ModelReply, list: ModelList | null): number | null {
  return reply.reportedCost ?? costFor(list, reply.model, reply.promptTokens, reply.completionTokens)
}
