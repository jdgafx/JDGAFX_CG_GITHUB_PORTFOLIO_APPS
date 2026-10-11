// The newest model OpenRouter resolves the app's alias to, read from its public model list. The list needs
// no key. A run waits for it no longer than LIST_TIMEOUT_MS, and anything missing is null, never a guess.
import { MODEL } from './stream'

/** OpenRouter's public model list. It needs no key. */
export const MODEL_LIST_URL = 'https://openrouter.ai/api/v1/models'
// Identifies this app to OpenRouter. Sent server side only.
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'
/** How long one function instance keeps the list it read. */
const CACHE_MS = 60 * 60 * 1000
/** The longest wait for the list, so a slow list cannot hold up a run. */
const LIST_TIMEOUT_MS = 3_000

/**
 * match: the reply came from the newest model. mismatch: it came from another model. unchecked: the newest
 * model is not known. not-reported: the reply named no model.
 */
export type ServedCheck = 'match' | 'mismatch' | 'unchecked' | 'not-reported'

// The newest model as the list last gave it. Only a list that was read is kept, so a failed read is tried again.
let kept: { newest: string | null; at: number } | undefined

/** The alias_target of the list entry for the requested alias. Null when the list or that entry is not there. */
function aliasTarget(json: unknown): string | null {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return null
  const entry = (data as Array<{ id?: unknown; alias_target?: { slug?: unknown } | null } | null>).find(item => item?.id === MODEL)
  const slug = entry?.alias_target?.slug
  return typeof slug === 'string' && slug !== '' ? slug : null
}

/** The newest model the list gives for the requested alias. Null when the list or its entry is unavailable. Never throws. */
export async function newestModel(): Promise<string | null> {
  if (kept && Date.now() - kept.at < CACHE_MS) return kept.newest
  try {
    const response = await fetch(MODEL_LIST_URL, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const newest = aliasTarget((await response.json()) as unknown)
    kept = { newest, at: Date.now() }
    return newest
  } catch {
    return null
  }
}

/** How the served model compares with the newest one. A reply that names no model is not-reported, whatever the list says. */
export function servedCheck(newest: string | null, served: string | null): ServedCheck {
  if (served === null) return 'not-reported'
  if (newest === null) return 'unchecked'
  return served === newest ? 'match' : 'mismatch'
}
