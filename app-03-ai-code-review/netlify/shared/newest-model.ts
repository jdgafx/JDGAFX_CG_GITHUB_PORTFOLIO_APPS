import type { ModelCheck } from '../../src/types'
import { MODEL } from './provider'

/** OpenRouter's public model list. It needs no key. The entry for the alias names, in alias_target.slug, the model the alias resolves to today. */
export const MODEL_LIST_URL = 'https://openrouter.ai/api/v1/models'
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'

/** How long one function instance keeps a resolved answer. */
export const NEWEST_CACHE_MS = 60 * 60 * 1000
/** The longest wait for the list. */
export const NEWEST_TIMEOUT_MS = 3_000

let kept: { id: string; at: number } | null = null
let pending: Promise<string | null> | null = null

/** The model the requested alias resolves to in the list, or null when the list has no such entry with a target. */
export function parseNewest(json: unknown): string | null {
  const entries: unknown[] = isRecord(json) && Array.isArray(json.data) ? json.data : []
  const entry = entries.find((item) => isRecord(item) && item.id === MODEL)
  const target = isRecord(entry) && isRecord(entry.alias_target) ? entry.alias_target.slug : undefined
  return typeof target === 'string' && target.trim() !== '' ? target : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One fetch of the list. A timeout, a bad status or unreadable JSON gives null. It never throws. */
export async function fetchNewest(timeoutMs = NEWEST_TIMEOUT_MS): Promise<string | null> {
  try {
    const response = await fetch(MODEL_LIST_URL, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    return parseNewest((await response.json()) as unknown)
  } catch {
    return null
  }
}

/**
 * The newest model id, or null when the list cannot say. Callers that arrive together share one fetch. Only a resolved
 * id is kept, so a list that answers without the alias is asked again on the next call.
 */
export function newestModel(): Promise<string | null> {
  if (kept && Date.now() - kept.at < NEWEST_CACHE_MS) return Promise.resolve(kept.id)
  pending ??= fetchNewest()
    .then((id) => {
      if (id) kept = { id, at: Date.now() }
      return id
    })
    .finally(() => {
      pending = null
    })
  return pending
}

/** Forgets the kept answer, so a test can give the next call a different list. */
export function resetNewestModel(): void {
  kept = null
  pending = null
}

/** The newest id if the list answers within `ms`, else null. A run waits for it only within what is left of its budget. */
export async function waitForNewest(newest: Promise<string | null>, ms: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, ms), null)
  })
  try {
    return await Promise.race([newest, late])
  } finally {
    clearTimeout(timer)
  }
}

/** How the served model compares with the newest one. Nothing served is 'not-reported'; no list answer is 'unchecked'. */
export function servedCheck(newest: string | null, served: string | null): ModelCheck {
  if (served === null) return 'not-reported'
  if (newest === null) return 'unchecked'
  return served === newest ? 'match' : 'mismatch'
}
