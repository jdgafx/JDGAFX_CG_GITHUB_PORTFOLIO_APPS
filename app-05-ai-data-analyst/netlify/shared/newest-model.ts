import type { ModelCheck } from '../../src/types'
import { withDeadline } from './deadline'
import { MODEL } from './provider'

/** OpenRouter's public model list. It needs no key. Each alias entry names the model it resolves to today. */
export const MODEL_LIST_URL = 'https://openrouter.ai/api/v1/models'

/** Identifies this portfolio app to OpenRouter. It names the project, never a personal contact. */
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'

/** How long one function instance keeps a list answer that named the newest model. */
const CACHE_MS = 60 * 60 * 1000

/** The longest wait for the list. A run reads it after its model call, so a slow list adds at most this much. */
const LIST_LIMIT_MS = 3_000

let kept: { id: string; at: number } | null = null
let pending: Promise<string | null> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads the list's JSON: the alias_target of the entry whose id is the requested alias. Null when there is no such entry. */
export function parseNewest(json: unknown): string | null {
  const entries = isRecord(json) && Array.isArray(json.data) ? json.data : []
  for (const entry of entries) {
    if (!isRecord(entry) || entry.id !== MODEL || !isRecord(entry.alias_target)) continue
    const target = entry.alias_target.slug
    if (typeof target === 'string' && target !== '') return target
  }
  return null
}

/** One fetch of the list. Any failure, a bad status, a timeout or unreadable JSON gives null. It never throws. */
async function fetchNewest(): Promise<string | null> {
  try {
    return await withDeadline(LIST_LIMIT_MS, undefined, async (signal) => {
      const response = await fetch(MODEL_LIST_URL, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal,
      })
      if (!response.ok) return null
      return parseNewest((await response.json()) as unknown)
    })
  } catch {
    return null
  }
}

/**
 * The newest model the requested alias resolves to, or null when the list cannot say. Only a resolved id is kept
 * for an hour, so a list that answers without the entry is asked again on the next call. Callers that arrive
 * together share one fetch.
 */
export function newestModel(): Promise<string | null> {
  if (kept && Date.now() - kept.at < CACHE_MS) return Promise.resolve(kept.id)
  pending ??= fetchNewest()
    .then((id) => {
      if (id !== null) kept = { id, at: Date.now() }
      return id
    })
    .finally(() => {
      pending = null
    })
  return pending
}

/** Whether the reply came from the newest model. A reply that named no model cannot be shown to have. */
export function servedCheck(newest: string | null, served: string | null): ModelCheck {
  if (served === null) return 'not-reported'
  if (newest === null) return 'unchecked'
  return served === newest ? 'match' : 'mismatch'
}

/** How bad each check is, for a run with several model calls. */
const SEVERITY: Record<ModelCheck, number> = { match: 0, unchecked: 1, 'not-reported': 2, mismatch: 3 }

/**
 * The worst check across a run's model calls, with the served id it is about, so a mismatch on any call shows.
 * Mismatch outranks not-reported, which outranks unchecked, which outranks match. A run with no call is not-reported.
 */
export function runCheck(newest: string | null, served: Array<string | null>): { modelCheck: ModelCheck; checkedModel: string | null } {
  let worst: { modelCheck: ModelCheck; checkedModel: string | null } = { modelCheck: 'not-reported', checkedModel: null }
  let worstSeverity = -1
  for (const model of served) {
    const modelCheck = servedCheck(newest, model)
    if (SEVERITY[modelCheck] > worstSeverity) {
      worst = { modelCheck, checkedModel: model }
      worstSeverity = SEVERITY[modelCheck]
    }
  }
  return worst
}
