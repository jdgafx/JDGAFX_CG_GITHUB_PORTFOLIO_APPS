import type { ModelCheck } from './contract'
import { MODEL } from './provider'

/** OpenRouter's public model list. It needs no key. */
export const MODEL_LIST_URL = 'https://openrouter.ai/api/v1/models'

/** Sent with the list request, so OpenRouter can tell this app's traffic apart. */
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'

/** How long one function instance keeps the model it read. */
const CACHE_MS = 60 * 60 * 1000

/** The longest wait for the list. The run reads it after the model call, so a slow list must not hold the run up. */
const LIST_TIMEOUT_MS = 3_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The model the list says the requested alias resolves to today, or null when the list does not say. */
function newestIn(json: unknown): string | null {
  if (!isRecord(json) || !Array.isArray(json.data)) return null
  const entry: unknown = json.data.find((item) => isRecord(item) && item.id === MODEL)
  if (!isRecord(entry) || !isRecord(entry.alias_target)) return null
  const slug = entry.alias_target.slug
  return typeof slug === 'string' && slug !== '' ? slug : null
}

/** One fetch of the list. A bad status, a timeout or unreadable JSON gives null. It never throws. */
async function fetchNewest(): Promise<string | null> {
  try {
    const response = await fetch(MODEL_LIST_URL, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    })
    if (!response.ok) return null
    return newestIn((await response.json()) as unknown)
  } catch {
    return null
  }
}

/**
 * A source that keeps the model for `CACHE_MS` and lets callers that arrive together share one fetch.
 * A null answer is not kept, so the next call tries again.
 */
export function createNewestModelSource(
  load: () => Promise<string | null> = fetchNewest,
  now: () => number = Date.now,
): () => Promise<string | null> {
  let kept: { model: string; at: number } | null = null
  let pending: Promise<string | null> | null = null
  return () => {
    if (kept && now() - kept.at < CACHE_MS) return Promise.resolve(kept.model)
    pending ??= load()
      .then((model) => {
        if (model) kept = { model, at: now() }
        return model
      })
      .finally(() => {
        pending = null
      })
    return pending
  }
}

/** The newest model for the running function instance. */
export const newestModel = createNewestModelSource()

/**
 * Compares the model that answered with the newest one. `not-reported` when the reply named no model,
 * `unchecked` when the list did not say which is newest, otherwise `match` or `mismatch`.
 */
export function servedCheck(newest: string | null, served: string | null): ModelCheck {
  if (served === null) return 'not-reported'
  if (newest === null) return 'unchecked'
  return served === newest ? 'match' : 'mismatch'
}
