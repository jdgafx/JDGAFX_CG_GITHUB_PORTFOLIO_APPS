// Reads the newest model the app's alias resolves to, and checks the served model against it. The check
// only labels a run for the page: nothing here refuses a reply or stops a run.
import { raceAbort } from './deadline'
import { isRecord } from './guards'
import { MODEL } from './provider'

/** OpenRouter's public model list. It needs no key. */
export const MODEL_LIST_URL = 'https://openrouter.ai/api/v1/models'

/** Identifies this app to OpenRouter. */
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'

/** How long one function instance keeps the newest id it read. */
export const NEWEST_CACHE_MS = 60 * 60 * 1000

/** The longest wait for the list. A run reads it alongside its model call, so a slow list must not hold the run. */
export const NEWEST_LIST_TIMEOUT_MS = 3_000

/** How one served model compares with the newest one. */
export type ModelCheck = 'match' | 'mismatch' | 'unchecked' | 'not-reported'

/** The newest model id, or null when the list cannot say. It never throws. */
export type NewestSource = () => Promise<string | null>

/** The alias entry's alias_target.slug: the model the list says the alias resolves to today. Null when the entry is missing. */
export function parseNewest(json: unknown): string | null {
  const entries: unknown[] = isRecord(json) && Array.isArray(json.data) ? json.data : []
  const entry = entries.find(item => isRecord(item) && item.id === MODEL)
  const target = isRecord(entry) && isRecord(entry.alias_target) ? entry.alias_target.slug : undefined
  return typeof target === 'string' && target !== '' ? target : null
}

/** One fetch of the list. Any failure, a bad status, a timeout or unreadable JSON gives null. */
export async function fetchNewest(timeoutMs = NEWEST_LIST_TIMEOUT_MS): Promise<string | null> {
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    return await raceAbort(
      fetch(MODEL_LIST_URL, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal }).then(async response =>
        response.ok ? parseNewest((await response.json()) as unknown) : null,
      ),
      signal,
    )
  } catch {
    return null
  }
}

/**
 * A source that keeps the id it read for NEWEST_CACHE_MS and lets callers that arrive together share one read.
 * Only a non-null id is kept, so a list that lacks the alias is read again on the next call.
 */
export function createNewestSource(load: () => Promise<string | null> = fetchNewest, now: () => number = Date.now): NewestSource {
  let kept: { id: string; at: number } | null = null
  let pending: Promise<string | null> | null = null
  return () => {
    if (kept && now() - kept.at < NEWEST_CACHE_MS) return Promise.resolve(kept.id)
    pending ??= load()
      .catch(() => null)
      .then(id => {
        if (id) kept = { id, at: now() }
        return id
      })
      .finally(() => {
        pending = null
      })
    return pending
  }
}

/** The newest model for the running function instance. */
export const newestModel: NewestSource = createNewestSource()

/** Compares one served model with the newest one. A reply that names no model cannot be checked, so it is not-reported. */
export function servedCheck(newest: string | null, served: string | null): ModelCheck {
  if (served === null) return 'not-reported'
  if (newest === null) return 'unchecked'
  return served === newest ? 'match' : 'mismatch'
}

const SEVERITY: Record<ModelCheck, number> = { match: 0, unchecked: 1, 'not-reported': 2, mismatch: 3 }

/** The worst of several checks: a mismatch outranks a missing name, which outranks an unchecked call. */
export function worstCheck(checks: readonly ModelCheck[]): ModelCheck {
  return checks.reduce<ModelCheck>((worst, check) => (SEVERITY[check] > SEVERITY[worst] ? check : worst), 'match')
}
