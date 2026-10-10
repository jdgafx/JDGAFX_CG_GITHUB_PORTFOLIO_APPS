import { isValidPackageName, MAX_PACKAGES } from '../../netlify/shared/contract'
import { addDays } from './dates'

/** One day of the public npm download counts. */
export interface Day {
  day: string
  downloads: number
}

const RANGE_ENDPOINT = 'https://api.npmjs.org/downloads/range'
const REQUEST_TIMEOUT_MS = 10_000
/** The message for a read that never reached npm. Shown for a single package and for a whole batch, so both say the same thing. */
const NETWORK_MESSAGE = 'Could not reach npm. Check your connection, then try again.'
/** npm publishes a day or two late, so the request reaches back this many days past the window to find the latest published day. */
const LAG_ALLOWANCE_DAYS = 7
/** Days of history always requested, whatever the window, so spike detection has weeks of same-weekday baseline behind a 30-day view. */
export const HISTORY_DAYS = 365
const DATE = /^\d{4}-\d{2}-\d{2}$/

export type NpmErrorKind = 'not-found' | 'rate-limit' | 'timeout' | 'network' | 'unexpected'

/** A failed npm request. The message is plain language and safe to show as it is. */
export class NpmError extends Error {
  readonly kind: NpmErrorKind

  constructor(kind: NpmErrorKind, message: string) {
    super(message)
    this.name = 'NpmError'
    this.kind = kind
  }
}

/** The outcome of one package's request: its daily counts, or why they could not be had. */
export type PackageOutcome = { name: string; days: Day[] } | { name: string; error: NpmError }

/** Scoped names (`@scope/name`) carry a slash, so the name is encoded into one path segment. */
export function rangeUrl(name: string, start: string, end: string): string {
  return `${RANGE_ENDPOINT}/${start}:${end}/${encodeURIComponent(name)}`
}

/** The first and last date to request for a window of `days` days, given today's UTC date. Never shorter than HISTORY_DAYS. */
export function requestRange(days: number, today: string): { start: string; end: string } {
  return { start: addDays(today, -(Math.max(days, HISTORY_DAYS) + LAG_ALLOWANCE_DAYS - 1)), end: today }
}

/**
 * Reads the single-package range reply into days, oldest first. Anything that is not the documented
 * shape (a `downloads` array of `{ day, downloads }`) is an error rather than a guess.
 */
export function parseRange(json: unknown): Day[] {
  const list = typeof json === 'object' && json !== null ? (json as { downloads?: unknown }).downloads : undefined
  if (!Array.isArray(list)) throw new NpmError('unexpected', 'npm sent a reply this page could not read.')
  const days = list.map((entry: unknown): Day => {
    const { day, downloads } = (entry ?? {}) as { day?: unknown; downloads?: unknown }
    if (typeof day !== 'string' || !DATE.test(day) || typeof downloads !== 'number' || !Number.isFinite(downloads) || downloads < 0) {
      throw new NpmError('unexpected', 'npm sent a reply this page could not read.')
    }
    return { day, downloads }
  })
  return days.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}

/** Maps a failed HTTP status to a message the viewer can act on. */
function errorForStatus(name: string, status: number): NpmError {
  if (status === 404) return new NpmError('not-found', `"${name}" is not on npm. Check the spelling.`)
  if (status === 429) return new NpmError('rate-limit', 'npm is limiting requests right now. Wait a minute, then try again.')
  return new NpmError('unexpected', `npm answered with an error (HTTP ${status}). Try again in a moment.`)
}

/** Fetches one package's daily downloads. Rethrows the caller's own abort; every other failure is an NpmError. */
export async function fetchDownloads(name: string, start: string, end: string, signal?: AbortSignal): Promise<Day[]> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(rangeUrl(name, start, end), { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  } catch (err) {
    if (signal?.aborted) throw err
    if (timeout.aborted) throw new NpmError('timeout', `npm did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds. Try again.`)
    throw new NpmError('network', NETWORK_MESSAGE)
  }
  if (!response.ok) throw errorForStatus(name, response.status)
  try {
    return parseRange(await response.json())
  } catch (err) {
    if (err instanceof NpmError) throw err
    throw new NpmError('unexpected', 'npm sent a reply this page could not read.')
  }
}

/**
 * Fetches every package at once, one request each: npm's bulk form rejects any list that contains a
 * scoped name, and one request per package lets a single failure show beside the packages that worked.
 */
export async function loadDownloads(names: string[], days: number, today: string, signal?: AbortSignal): Promise<PackageOutcome[]> {
  if (names.length === 0 || names.length > MAX_PACKAGES || !names.every(isValidPackageName)) {
    throw new RangeError(`Pass 1 to ${MAX_PACKAGES} valid package names`)
  }
  const { start, end } = requestRange(days, today)
  const settled = await Promise.allSettled(names.map((name) => fetchDownloads(name, start, end, signal)))
  return settled.map((result, index): PackageOutcome => {
    const name = names[index]
    if (result.status === 'fulfilled') return { name, days: result.value }
    return { name, error: result.reason instanceof NpmError ? result.reason : new NpmError('network', NETWORK_MESSAGE) }
  })
}
