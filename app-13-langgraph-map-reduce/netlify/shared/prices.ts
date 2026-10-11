import { z } from 'zod'
import type { PriceRate } from '../../src/types/frames'
import { newestModel } from './newest-model'

/** OpenRouter's public model list. It needs no key. */
export const MODELS_URL = 'https://openrouter.ai/api/v1/models'

/** Identifies the portfolio bot to OpenRouter on the one list fetch. */
export const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'

/** The list is kept in memory for this long per function instance, then fetched again. */
export const PRICE_TTL_MS = 60 * 60 * 1000
/** The list answers in well under a second. A fetch that takes longer is given up, and the run shows "price unavailable". */
export const PRICE_FETCH_TIMEOUT_MS = 3_000

/** Price per token in USD by model id, as OpenRouter lists it. */
export type PriceList = ReadonlyMap<string, PriceRate>

/** A price as OpenRouter sends it, a string such as "0.0000001". An empty or missing one is an error, never zero. */
const perToken = z.union([z.string().trim().min(1), z.number()]).transform(Number)

const entrySchema = z.object({
  id: z.string(),
  canonical_slug: z.string().optional(),
  pricing: z.object({ prompt: perToken, completion: perToken }),
})

/** An alias entry names the model it resolves to today in alias_target.slug. */
const aliasSchema = z.object({
  id: z.string(),
  alias_target: z.object({ slug: z.string() }),
})

/**
 * The public list as the server reads it, once: prices by model id, and the model each alias entry resolves to.
 * One fetch serves both, so the newest-model check adds no request and no wait.
 */
export interface ModelList {
  prices: PriceList
  /** Alias id, such as ~anthropic/claude-haiku-latest, to the model it resolves to today. */
  aliases: ReadonlyMap<string, string>
}

/**
 * Reads the list's pricing.prompt and pricing.completion (USD per token, sent as strings) for every model, and each
 * alias entry's alias_target.slug. An entry whose price is missing, not a number, or negative (OpenRouter lists
 * variable-price routers as -1) is left out of the prices, so it reads as unavailable. A model is found by its id,
 * and also by its dated canonical slug when the entry is not a variant such as ":batch", which shares the slug but
 * has its own price. Returns null when the payload is not a model list or no entry has a price. The tier that
 * applies above 100,000 prompt tokens is not read: a run holds at most 20,000 characters.
 */
export function parseModelList(payload: unknown): ModelList | null {
  const outer = z.object({ data: z.array(z.unknown()) }).safeParse(payload)
  if (!outer.success) return null
  const list = new Map<string, PriceRate>()
  const slugs = new Map<string, PriceRate>()
  const aliases = new Map<string, string>()
  for (const raw of outer.data.data) {
    const alias = aliasSchema.safeParse(raw)
    if (alias.success) aliases.set(alias.data.id, alias.data.alias_target.slug)
    const entry = entrySchema.safeParse(raw)
    if (!entry.success) continue
    const { id, canonical_slug: slug, pricing } = entry.data
    const rate = { prompt: pricing.prompt, completion: pricing.completion }
    if (![rate.prompt, rate.completion].every((n) => Number.isFinite(n) && n >= 0)) continue
    list.set(id, rate)
    if (slug && !id.includes(':')) slugs.set(slug, rate)
  }
  for (const [slug, rate] of slugs) if (!list.has(slug)) list.set(slug, rate)
  return list.size > 0 ? { prices: list, aliases } : null
}

/** The prices of the list, or null when the payload has none. See parseModelList. */
export function parsePriceList(payload: unknown): PriceList | null {
  return parseModelList(payload)?.prices ?? null
}

interface LoadOptions {
  fetchImpl?: typeof fetch
  now?: number
  timeoutMs?: number
}

let cached: { at: number; list: ModelList } | null = null
let pending: Promise<ModelList | null> | null = null

/** Forgets the cached list. Tests call it so one test's list never reaches the next. */
export function resetPriceCache(): void {
  cached = null
  pending = null
}

/** One fetch of the list. Any failure, a timeout included, is null. The deadline does not depend on how fetch treats an abort. */
async function fetchList(fetchImpl: typeof fetch, timeoutMs: number): Promise<ModelList | null> {
  const call = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      call.abort()
      resolve(null)
    }, timeoutMs)
  })
  const read = (async (): Promise<ModelList | null> => {
    const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT }
    const response = await fetchImpl(MODELS_URL, { signal: call.signal, headers })
    return response.ok ? parseModelList(await response.json()) : null
  })().catch(() => null)
  try {
    return await Promise.race([read, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * OpenRouter's current model list, or null when it cannot be had. A list is reused for an hour only when it names
 * the newest model: a list that lacks the alias entry is fetched again by the next run, so it cannot pin the newest
 * check as unchecked. Runs that start together share one fetch. A failure is not kept either. There is no other
 * source of prices.
 */
export function loadModelList(options: LoadOptions = {}): Promise<ModelList | null> {
  const now = options.now ?? Date.now()
  if (cached && now - cached.at < PRICE_TTL_MS) return Promise.resolve(cached.list)
  if (pending) return pending
  const started: Promise<ModelList | null> = fetchList(options.fetchImpl ?? fetch, options.timeoutMs ?? PRICE_FETCH_TIMEOUT_MS)
    .then((list) => {
      if (list && newestModel(list) !== null) cached = { at: now, list }
      return list
    })
    .finally(() => {
      if (pending === started) pending = null
    })
  pending = started
  return started
}

/** OpenRouter's current model prices, or null when they cannot be had. See loadModelList. */
export function loadPrices(options: LoadOptions = {}): Promise<PriceList | null> {
  return loadModelList(options).then((list) => list?.prices ?? null)
}
