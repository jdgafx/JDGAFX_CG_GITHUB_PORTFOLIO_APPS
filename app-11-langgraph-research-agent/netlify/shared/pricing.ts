import { isRecord } from './json'
import { withLimit } from './limit'
import { NODE_MODEL, round12 } from './models'
import type { TokenUsage } from './openrouter'

/** OpenRouter's public model list. It needs no key. Each entry has pricing.prompt and pricing.completion, USD per token, as strings. */
export const MODEL_LIST_URL = 'https://openrouter.ai/api/v1/models'

/** How long one function instance keeps the list it fetched. */
export const PRICE_CACHE_MS = 60 * 60 * 1000

/** The longest wait for the list. A run reads it for its first priced step, so a slow list must not eat the run budget. */
export const PRICE_LIST_TIMEOUT_MS = 3_000

/** What one token costs on one model, USD, as the list states it. */
export interface ListPrice {
  inPerToken: number
  outPerToken: number
  /** For an alias entry: the model the list says the alias resolves to today. */
  aliasTarget?: string
}

/** The list keyed by model id. There is no built-in copy: when the list cannot be had, no price can be shown. */
export type PriceBook = ReadonlyMap<string, ListPrice>

/** Gives the current list, or null when it cannot be fetched or read. It never throws. */
export type PriceBookSource = () => Promise<PriceBook | null>

/** A rate the list states as a string. Empty, negative (router entries use -1) and non-numeric rates are not prices. */
function rate(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

/** Reads the list's JSON. Null when it is not a list of models or none of its entries carries a usable price. */
export function parsePriceBook(json: unknown): PriceBook | null {
  const entries: unknown[] = isRecord(json) && Array.isArray(json.data) ? json.data : []
  const book = new Map<string, ListPrice>()
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !isRecord(entry.pricing)) continue
    const inPerToken = rate(entry.pricing.prompt)
    const outPerToken = rate(entry.pricing.completion)
    if (inPerToken === null || outPerToken === null) continue
    const target = isRecord(entry.alias_target) && typeof entry.alias_target.slug === 'string' ? entry.alias_target.slug : undefined
    book.set(entry.id, target === undefined ? { inPerToken, outPerToken } : { inPerToken, outPerToken, aliasTarget: target })
  }
  return book.size > 0 ? book : null
}

/** One fetch of the list. Any failure, a bad status, a timeout or unreadable JSON gives null. */
async function fetchPriceBook(): Promise<PriceBook | null> {
  try {
    return await withLimit(new AbortController().signal, PRICE_LIST_TIMEOUT_MS, async (signal) => {
      const response = await fetch(MODEL_LIST_URL, { headers: { Accept: 'application/json' }, signal })
      if (!response.ok) return null
      return parsePriceBook((await response.json()) as unknown)
    })
  } catch {
    return null
  }
}

/**
 * A source that keeps the list in memory for `PRICE_CACHE_MS` and lets callers that arrive together share
 * one fetch. A failed fetch is not kept, so the next call tries again.
 */
export function createPriceBookSource(load: () => Promise<PriceBook | null> = fetchPriceBook, now: () => number = Date.now): PriceBookSource {
  let kept: { book: PriceBook; at: number } | null = null
  let pending: Promise<PriceBook | null> | null = null
  return () => {
    if (kept && now() - kept.at < PRICE_CACHE_MS) return Promise.resolve(kept.book)
    pending ??= load()
      .then((book) => {
        if (book) kept = { book, at: now() }
        return book
      })
      .finally(() => {
        pending = null
      })
    return pending
  }
}

/** The list for the running function instance. */
export const livePriceBook: PriceBookSource = createPriceBookSource()

/** The newest model the list says the app's alias resolves to, or null when the list does not say. */
export function newestModel(book: PriceBook | null): string | null {
  return book?.get(NODE_MODEL)?.aliasTarget ?? null
}

/**
 * Why a reply is refused because it did not come from the newest model, or null when it did. A reply that
 * names no model is refused too: it cannot be shown to be the newest model.
 */
export function servedMismatch(newest: string, served: string | null): string | null {
  if (served === newest) return null
  return `The reply came from ${served ?? 'a model it did not name'}, not ${newest}, the newest Haiku that OpenRouter resolves ${NODE_MODEL} to. The run stopped, so nothing from that reply is shown. The call was billed, so its tokens and its cost still count.`
}

/**
 * The cost of one model call: its tokens (reasoning tokens count as output) times the list price of the model that answered. Null, never a
 * guess, when the reply named no model, the list is missing or has no price for that model, or the token counts are missing.
 */
export function costFor(book: PriceBook | null, servedModel: string | null, usage: TokenUsage): number | null {
  const price = book && servedModel ? book.get(servedModel) : undefined
  if (!price || usage.prompt_tokens === undefined || usage.completion_tokens === undefined) return null
  // Reasoning tokens are billed as output. OpenRouter already counts them in completion_tokens; if a reply
  // reports more reasoning tokens than completion tokens, the figure cannot include them, so they are added.
  const reasoning = usage.reasoning_tokens ?? 0
  const output = reasoning > usage.completion_tokens ? usage.completion_tokens + reasoning : usage.completion_tokens
  return round12(usage.prompt_tokens * price.inPerToken + output * price.outPerToken)
}
