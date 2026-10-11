import type { ModelCheck } from './contract'
import { MODEL } from './provider'

// OpenRouter's public model list. It needs no key, so the request names this app in its User-Agent.
export const MODEL_LIST_URL = 'https://openrouter.ai/api/v1/models'
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'

// The longest wait for the list. A run starts the list with its model call, so a slow list must not add to it.
const LIST_TIMEOUT_MS = 3_000
const CACHE_MS = 60 * 60 * 1000

let kept: { id: string; at: number } | null = null

interface ListEntry {
  id: string
  alias_target?: { slug?: unknown } | null
}

// The alias_target of the list entry for the requested alias, or null when the list does not name one.
function parseNewest(json: unknown): string | null {
  const data = typeof json === 'object' && json !== null && 'data' in json ? json.data : undefined
  if (!Array.isArray(data)) return null
  const entry = (data as ListEntry[]).find(item => item.id === MODEL)
  const slug = entry?.alias_target?.slug
  return typeof slug === 'string' && slug !== '' ? slug : null
}

async function fetchNewest(): Promise<string | null> {
  const response = await fetch(MODEL_LIST_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
  })
  if (!response.ok) return null
  return parseNewest(await response.json())
}

// The newest model the list names for the requested alias, or null when the list cannot be had. It never throws.
// Only a resolved id is kept, for an hour per function instance; a null is not, so the next call asks again.
export async function newestModel(): Promise<string | null> {
  if (kept && Date.now() - kept.at < CACHE_MS) return kept.id
  try {
    const id = await fetchNewest()
    if (id) kept = { id, at: Date.now() }
    return id
  } catch {
    return null
  }
}

// How a served model compares with the newest one. A reply that names no model is not reported, and an
// unknown newest model leaves the check unchecked.
export function servedCheck(newest: string | null, served: string | null): ModelCheck {
  if (served === null) return 'not-reported'
  if (newest === null) return 'unchecked'
  return served === newest ? 'match' : 'mismatch'
}
