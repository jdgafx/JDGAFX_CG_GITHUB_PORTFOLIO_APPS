import { z } from 'zod'
import type { PriceRate } from '../../src/types/frames'

/** OpenRouter's public model list. It needs no key. */
export const MODELS_URL = 'https://openrouter.ai/api/v1/models'

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

/**
 * Reads the list's pricing.prompt and pricing.completion (USD per token, sent as strings) for every model. An
 * entry whose price is missing, not a number, or negative (OpenRouter lists variable-price routers as -1) is
 * left out, so it reads as unavailable. A model is found by its id, and also by its dated canonical slug when
 * the entry is not a variant such as ":batch", which shares the slug but has its own price. Returns null when the
 * payload is not a model list. The tier that applies above 100,000 prompt tokens is not read: a run holds at
 * most 20,000 characters.
 */
export function parsePriceList(payload: unknown): PriceList | null {
  const outer = z.object({ data: z.array(z.unknown()) }).safeParse(payload)
  if (!outer.success) return null
  const list = new Map<string, PriceRate>()
  const slugs = new Map<string, PriceRate>()
  for (const raw of outer.data.data) {
    const entry = entrySchema.safeParse(raw)
    if (!entry.success) continue
    const { id, canonical_slug: slug, pricing } = entry.data
    const rate = { prompt: pricing.prompt, completion: pricing.completion }
    if (![rate.prompt, rate.completion].every((n) => Number.isFinite(n) && n >= 0)) continue
    list.set(id, rate)
    if (slug && !id.includes(':')) slugs.set(slug, rate)
  }
  for (const [slug, rate] of slugs) if (!list.has(slug)) list.set(slug, rate)
  return list.size > 0 ? list : null
}

interface LoadOptions {
  fetchImpl?: typeof fetch
  now?: number
  timeoutMs?: number
}

let cached: { at: number; list: PriceList } | null = null
let pending: Promise<PriceList | null> | null = null

/** Forgets the cached list. Tests call it so one test's list never reaches the next. */
export function resetPriceCache(): void {
  cached = null
  pending = null
}

/** One fetch of the list. Any failure, a timeout included, is null. The deadline does not depend on how fetch treats an abort. */
async function fetchList(fetchImpl: typeof fetch, timeoutMs: number): Promise<PriceList | null> {
  const call = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      call.abort()
      resolve(null)
    }, timeoutMs)
  })
  const read = (async (): Promise<PriceList | null> => {
    const response = await fetchImpl(MODELS_URL, { signal: call.signal, headers: { Accept: 'application/json' } })
    return response.ok ? parsePriceList(await response.json()) : null
  })().catch(() => null)
  try {
    return await Promise.race([read, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * OpenRouter's current model prices, or null when they cannot be had. A list that was read less than an hour ago
 * is reused, and runs that start together share one fetch. A failure is not kept: the next run tries again. There is
 * no other source of prices.
 */
export function loadPrices(options: LoadOptions = {}): Promise<PriceList | null> {
  const now = options.now ?? Date.now()
  if (cached && now - cached.at < PRICE_TTL_MS) return Promise.resolve(cached.list)
  if (pending) return pending
  const started: Promise<PriceList | null> = fetchList(options.fetchImpl ?? fetch, options.timeoutMs ?? PRICE_FETCH_TIMEOUT_MS)
    .then((list) => {
      if (list) cached = { at: now, list }
      return list
    })
    .finally(() => {
      if (pending === started) pending = null
    })
  pending = started
  return started
}
