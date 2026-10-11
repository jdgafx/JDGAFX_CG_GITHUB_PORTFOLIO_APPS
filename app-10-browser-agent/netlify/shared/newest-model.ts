import type { ModelCheck } from '../../src/types'
import { withDeadline } from './deadline'
import { MODEL } from './provider'

/** OpenRouter's public model list. It needs no key. Each alias entry has an alias_target whose slug is the model the alias resolves to today. */
export const MODEL_LIST_URL = 'https://openrouter.ai/api/v1/models'

/** Identifies this app to the provider. It never carries a personal contact. */
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'

/** How long one function instance keeps the list it fetched. */
export const LIST_CACHE_MS = 60 * 60 * 1000

/** The longest wait for the list. A run reads it after its model call, so a slow list must not add more than this. */
export const LIST_TIMEOUT_MS = 3_000

/** Each alias id in the list, mapped to the model it resolves to today. */
export type AliasTargets = ReadonlyMap<string, string>

/** Gives the current alias targets, or null when they cannot be had. It never throws. */
export type AliasTargetSource = () => Promise<AliasTargets | null>

/** Reads the list's JSON. Null when no entry names an alias target. */
export function parseAliasTargets(json: unknown): AliasTargets | null {
  const data = (json as { data?: unknown } | null)?.data
  const pairs = Array.isArray(data) ? data.map(targetOf).filter((pair): pair is [string, string] => pair !== null) : []
  return pairs.length > 0 ? new Map(pairs) : null
}

/** One entry's id and alias target, or null when the entry is not an alias with a target. */
function targetOf(entry: unknown): [string, string] | null {
  const { id, alias_target: alias } = (entry ?? {}) as { id?: unknown; alias_target?: { slug?: unknown } | null }
  if (typeof id !== 'string' || typeof alias?.slug !== 'string') return null
  return [id, alias.slug]
}

/** One fetch of the list. Any failure, a bad status, a timeout or unreadable JSON gives null. */
async function fetchAliasTargets(): Promise<AliasTargets | null> {
  try {
    return await withDeadline(LIST_TIMEOUT_MS, undefined, async (signal) => {
      const response = await fetch(MODEL_LIST_URL, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal })
      if (!response.ok) return null
      return parseAliasTargets((await response.json()) as unknown)
    })
  } catch {
    return null
  }
}

/**
 * A source that keeps the parsed list in memory for `LIST_CACHE_MS` and lets callers that arrive together share
 * one fetch. A failed fetch, or a list without the requested alias, is not kept, so the next call tries again.
 */
export function createAliasTargetSource(load: () => Promise<AliasTargets | null> = fetchAliasTargets, now: () => number = Date.now): AliasTargetSource {
  let kept: { targets: AliasTargets; at: number } | null = null
  let pending: Promise<AliasTargets | null> | null = null
  return () => {
    if (kept && now() - kept.at < LIST_CACHE_MS) return Promise.resolve(kept.targets)
    pending ??= load()
      .catch(() => null)
      .then((targets) => {
        if (targets?.has(MODEL)) kept = { targets, at: now() }
        return targets
      })
      .finally(() => {
        pending = null
      })
    return pending
  }
}

/** The list for the running function instance. */
const liveAliasTargets: AliasTargetSource = createAliasTargetSource()

/** The newest model the list says the requested alias resolves to, or null when the list does not say. It never throws. */
export async function newestModel(source: AliasTargetSource = liveAliasTargets): Promise<string | null> {
  return (await source())?.get(MODEL) ?? null
}

/**
 * How the served model compares with the newest one. A reply that names no model is `not-reported`, a list that
 * names no newest model is `unchecked`, and otherwise the two are a `match` or a `mismatch`.
 */
export function servedCheck(newest: string | null, served: string | null): ModelCheck {
  if (served === null) return 'not-reported'
  if (newest === null) return 'unchecked'
  return served === newest ? 'match' : 'mismatch'
}
