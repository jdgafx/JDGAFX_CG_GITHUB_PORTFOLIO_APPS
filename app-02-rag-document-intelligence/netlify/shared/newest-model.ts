import { MODEL } from './provider'

/** OpenRouter's public model list. It needs no key. */
export const MODEL_LIST_URL = 'https://openrouter.ai/api/v1/models'

// Identifies this app to OpenRouter. Contact details stay out of the header.
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'

/** How long one function instance keeps the newest model it read. */
export const NEWEST_CACHE_MS = 60 * 60 * 1000

/** The longest wait for the list, so a slow list cannot hold up a run. */
export const NEWEST_TIMEOUT_MS = 3_000

/** Whether the served model is the newest one the requested alias resolves to. */
export type ModelCheck = 'match' | 'mismatch' | 'unchecked' | 'not-reported'

/** Gives the newest model id, or null when the list cannot be had or does not name one. It never throws. */
export type NewestSource = () => Promise<string | null>

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** The alias_target of the list entry whose id is the requested alias, or null when the list does not say. */
export function parseNewest(json: unknown): string | null {
  const data: unknown = asRecord(json)['data']
  const entry = Array.isArray(data) ? (data as unknown[]).map(asRecord).find(item => item['id'] === MODEL) : undefined
  const slug = asRecord(entry?.['alias_target'])['slug']
  return typeof slug === 'string' && slug !== '' ? slug : null
}

async function fetchNewest(): Promise<string | null> {
  try {
    const response = await fetch(MODEL_LIST_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(NEWEST_TIMEOUT_MS),
    })
    if (!response.ok) return null
    return parseNewest((await response.json()) as unknown)
  } catch (err) {
    console.error('OpenRouter model list lookup failed:', err instanceof Error ? err.name : 'non-error')
    return null
  }
}

/**
 * A source that keeps a resolved newest id for an hour and lets callers that arrive together share one fetch.
 * Only a resolved id is kept, so a list that lacks the alias entry is asked again on the next call.
 */
export function createNewestSource(load: () => Promise<string | null> = fetchNewest, now: () => number = Date.now): NewestSource {
  let kept: { newest: string; at: number } | null = null
  let pending: Promise<string | null> | null = null
  return () => {
    if (kept && now() - kept.at < NEWEST_CACHE_MS) return Promise.resolve(kept.newest)
    pending ??= load()
      .then(newest => {
        if (newest !== null) kept = { newest, at: now() }
        return newest
      })
      .finally(() => {
        pending = null
      })
    return pending
  }
}

/** The newest model for the running function instance. */
export const newestModel: NewestSource = createNewestSource()

/**
 * Compares the served model with the newest one. A reply that names no model is 'not-reported' and is never
 * matched against the requested alias.
 */
export function servedCheck(newest: string | null, served: string | null): ModelCheck {
  if (served === null) return 'not-reported'
  if (newest === null) return 'unchecked'
  return served === newest ? 'match' : 'mismatch'
}

// Higher is worse. A run shows the worst check among its model calls.
const SEVERITY: Record<ModelCheck, number> = { match: 0, unchecked: 1, 'not-reported': 2, mismatch: 3 }

/** The worst of several checks, in the order mismatch, not-reported, unchecked, match. No checks gives 'not-reported'. */
export function worstCheck(checks: ModelCheck[]): ModelCheck {
  if (checks.length === 0) return 'not-reported'
  return checks.reduce((worst, check) => (SEVERITY[check] > SEVERITY[worst] ? check : worst))
}
