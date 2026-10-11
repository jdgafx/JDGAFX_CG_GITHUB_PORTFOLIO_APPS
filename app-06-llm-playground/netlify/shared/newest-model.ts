import { MODEL, type ModelCheck } from './contract'
import { withDeadline } from './deadline'
import { isRecord, strOrNull } from './parse'

/** OpenRouter's public model list. It needs no key, and each alias entry names the model it resolves to today. */
export const MODEL_LIST_URL = 'https://openrouter.ai/api/v1/models'
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'
/** How long one function instance keeps the newest id it found. */
export const NEWEST_CACHE_MS = 60 * 60 * 1000
/** The longest wait for the list. It starts with the panels, so a slow list cannot add more than this to a run. */
export const NEWEST_TIMEOUT_MS = 3_000

/** The newest model the list says the alias resolves to, or null when the list does not say. */
export function parseNewest(json: unknown, alias: string): string | null {
  const entries: unknown[] = isRecord(json) && Array.isArray(json.data) ? json.data : []
  const entry = entries.find((item): item is Record<string, unknown> => isRecord(item) && item.id === alias)
  if (entry === undefined || !isRecord(entry.alias_target)) return null
  const target = strOrNull(entry.alias_target.slug)
  return target === null || target.trim() === '' ? null : target
}

/** One fetch of the list. Any failure, a bad status, a timeout or unreadable JSON gives null. It never throws. */
async function fetchNewest(): Promise<string | null> {
  try {
    return await withDeadline(NEWEST_TIMEOUT_MS, undefined, async signal => {
      const response = await fetch(MODEL_LIST_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal })
      if (!response.ok) return null
      return parseNewest((await response.json()) as unknown, MODEL)
    })
  } catch {
    return null
  }
}

export type NewestSource = () => Promise<string | null>

/**
 * A source that keeps the newest id for an hour and lets calls that arrive together share one fetch. Only a found id
 * is kept: a list that lacks the alias, or a failed fetch, is asked again on the next call.
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

/** The list for the running function instance. Start it before the model call and await it after. */
export const newestModel: NewestSource = createNewestSource()

/** The check of one served id. A reply that named no model is never compared; a list that gave no newest id leaves it unchecked. */
export function servedCheck(newest: string | null, served: string | null): ModelCheck {
  if (served === null) return 'not-reported'
  if (newest === null) return 'unchecked'
  return served === newest ? 'match' : 'mismatch'
}

/** What one reply records: its newest id and its check. A mismatch is logged; the reply is still shown. */
export function checkRecord(newest: string | null, served: string | null, requested: string): { newestModel: string | null; modelCheck: ModelCheck } {
  const modelCheck = servedCheck(newest, served)
  if (modelCheck === 'mismatch') console.warn(`model mismatch: served ${served}, newest ${newest}, requested ${requested}`)
  return { newestModel: newest, modelCheck }
}

/** The record of a call that was not checked: a visitor-picked panel, or a panel with no reply. */
export const NOT_CHECKED = { newestModel: null, modelCheck: null } as const
