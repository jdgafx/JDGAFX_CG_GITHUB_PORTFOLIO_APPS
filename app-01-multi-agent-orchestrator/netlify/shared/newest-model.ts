import type { ModelCheck, ModelFacts } from '../../src/types'
import { MODEL } from './provider'

/** OpenRouter's public model list. It needs no key. */
export const MODEL_LIST_URL = 'https://openrouter.ai/api/v1/models'
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'

/** How long one function instance keeps the newest model it found. */
export const NEWEST_CACHE_MS = 60 * 60 * 1000
/** The longest wait for the list. A slow list must not eat the run budget. */
export const NEWEST_TIMEOUT_MS = 3_000

/** Gives the newest model id the list names for the requested alias, or null. It never throws. */
export type NewestSource = () => Promise<string | null>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The alias entry's `alias_target.slug`: the model the list says the alias resolves to today. */
function parseNewest(json: unknown): string | null {
  const entries = isRecord(json) && Array.isArray(json.data) ? json.data : []
  for (const entry of entries) {
    if (!isRecord(entry) || entry.id !== MODEL || !isRecord(entry.alias_target)) continue
    const slug = entry.alias_target.slug
    return typeof slug === 'string' && slug !== '' ? slug : null
  }
  return null
}

/** One fetch of the list. Any failure, a bad status, a timeout or unreadable JSON gives null. */
async function fetchNewest(): Promise<string | null> {
  try {
    const response = await fetch(MODEL_LIST_URL, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(NEWEST_TIMEOUT_MS),
    })
    if (!response.ok) return null
    return parseNewest((await response.json()) as unknown)
  } catch {
    return null
  }
}

/**
 * A source that keeps a resolved id for `NEWEST_CACHE_MS` and lets callers that arrive together share one
 * fetch. Only a resolved id is kept: a list that answers without the alias is asked again on the next call.
 */
export function createNewestSource(load: () => Promise<string | null> = fetchNewest, now: () => number = Date.now): NewestSource {
  let kept: { id: string; at: number } | null = null
  let pending: Promise<string | null> | null = null
  return () => {
    if (kept && now() - kept.at < NEWEST_CACHE_MS) return Promise.resolve(kept.id)
    pending ??= load()
      .then((id) => {
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

/** Compares the served model with the newest. A reply that named no model is 'not-reported', whatever the list says. */
export function servedCheck(newest: string | null, served: string | null): ModelCheck {
  if (served === null) return 'not-reported'
  if (newest === null) return 'unchecked'
  return served === newest ? 'match' : 'mismatch'
}

/**
 * The model facts of one model call. A missing served model stays null: it is never replaced by the requested
 * alias or by another call's model. A mismatch is shown and logged, never refused.
 */
export function modelFacts(served: string | undefined, newest: string | null): ModelFacts {
  const servedModel = served || null
  const modelCheck = servedCheck(newest, servedModel)
  if (modelCheck === 'mismatch') console.warn(`model mismatch: served ${servedModel}, newest ${newest}, requested ${MODEL}`)
  return { servedModel, newestModel: newest, modelCheck }
}
