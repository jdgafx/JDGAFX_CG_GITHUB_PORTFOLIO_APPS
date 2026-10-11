import type { ModelCheck } from '../../src/types'
import { isRecord } from './guard'
import { MODEL } from './models'

/** OpenRouter's public model list. It needs no key. */
export const MODEL_LIST_URL = 'https://openrouter.ai/api/v1/models'

/** Sent with the list request. It names the project only, never a person. */
export const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'

/** How long one function instance keeps the newest model it read. */
export const NEWEST_CACHE_MS = 60 * 60 * 1000

/** The longest wait for the list. A run reads it after its first model call, so a slow list adds at most this much. */
export const NEWEST_TIMEOUT_MS = 3_000

/** Gives the newest model the list names for the requested alias, or null when it cannot be had. It never throws. */
export type NewestModelSource = () => Promise<string | null>

/** The model the list says the requested alias resolves to, or null when the list has no such entry or no target. */
export function parseNewestModel(json: unknown): string | null {
  const entries: unknown[] = isRecord(json) && Array.isArray(json.data) ? json.data : []
  const entry = entries.find((item) => isRecord(item) && item.id === MODEL)
  if (!isRecord(entry) || !isRecord(entry.alias_target) || typeof entry.alias_target.slug !== 'string') return null
  return entry.alias_target.slug
}

/** One fetch of the list. Any failure, a bad status, a timeout or unreadable JSON gives null. */
export async function fetchNewestModel(): Promise<string | null> {
  try {
    const response = await fetch(MODEL_LIST_URL, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(NEWEST_TIMEOUT_MS),
    })
    if (!response.ok) return null
    return parseNewestModel((await response.json()) as unknown)
  } catch {
    return null
  }
}

/**
 * A source that keeps the answer for `NEWEST_CACHE_MS` and lets callers that arrive together share one
 * fetch. Only a found model is kept, so a failed fetch is tried again on the next call.
 */
export function createNewestModelSource(load: () => Promise<string | null> = fetchNewestModel, now: () => number = Date.now): NewestModelSource {
  let kept: { model: string; at: number } | null = null
  let pending: Promise<string | null> | null = null
  return () => {
    if (kept && now() - kept.at < NEWEST_CACHE_MS) return Promise.resolve(kept.model)
    pending ??= load()
      .then((model) => {
        if (model !== null) kept = { model, at: now() }
        return model
      })
      .finally(() => {
        pending = null
      })
    return pending
  }
}

/** The newest model for the running function instance. */
export const newestModel: NewestModelSource = createNewestModelSource()

/**
 * Whether a reply came from the newest model. A reply that names no model is 'not-reported', and a run whose
 * list gave no newest model is 'unchecked'. Neither is a mismatch.
 */
export function servedCheck(newest: string | null, served: string | null): ModelCheck {
  if (served === null) return 'not-reported'
  if (newest === null) return 'unchecked'
  return served === newest ? 'match' : 'mismatch'
}
