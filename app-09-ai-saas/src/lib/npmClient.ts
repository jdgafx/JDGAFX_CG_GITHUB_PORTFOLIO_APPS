import type { Day, Release, ReleaseState, Rows } from '../../shared/types'

const RANGE_ENDPOINT = 'https://api.npmjs.org/downloads/range'
/** RUN_DATE minus 371 days: a 365-day window plus the 7 days npm may lag, inclusive. */
const RANGE_DAYS = 371
export const NPM_TIMEOUT_MS = 10_000
/** The function's own registry fetch times out at 15 s; the browser waits a little longer for its answer. */
export const RELEASES_TIMEOUT_MS = 20_000
export const MAX_NAMES = 4

const DAY = /^\d{4}-\d{2}-\d{2}$/
const NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/

export type FailReason = 'not-found' | 'timeout' | 'network' | 'bad-response'
export type RangeResult = { name: string; status: 'ok'; rows: Rows } | { name: string; status: 'failed'; reason: FailReason }
export interface ReleasesResult {
  name: string
  status: ReleaseState
  releases: Release[]
}

/** A package name as npm writes it (lower case, optional @scope/). Checked before the name reaches a URL. */
export function isPackageName(name: string): boolean {
  return name.length > 0 && name.length <= 214 && NAME.test(name)
}

export function todayUtc(now: Date = new Date()): Day {
  return now.toISOString().slice(0, 10)
}

export function addDays(day: Day, delta: number): Day {
  const t = Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

export function rangeUrl(name: string, runDate: Day): string {
  // A scoped name keeps its @ and encodes the slash: @scope%2Fname.
  return `${RANGE_ENDPOINT}/${addDays(runDate, -RANGE_DAYS)}:${runDate}/${name.replace('/', '%2F')}`
}

/** fetch with a hard timeout on top of the caller's own signal. Never cached. */
async function timedFetch(url: string, ms: number, outer?: AbortSignal): Promise<{ res: Response } | { timedOut: boolean }> {
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctl.abort()
  }, ms)
  const onOuter = () => ctl.abort()
  if (outer?.aborted) ctl.abort()
  else outer?.addEventListener('abort', onOuter)
  try {
    return { res: await fetch(url, { cache: 'no-store', signal: ctl.signal }) }
  } catch {
    return { timedOut }
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuter)
  }
}

function parseRows(body: unknown): Rows | null {
  const list = (body as { downloads?: unknown } | null)?.downloads
  if (!Array.isArray(list)) return null
  const rows: Rows = {}
  for (const item of list) {
    const { day, downloads } = (item ?? {}) as { day?: unknown; downloads?: unknown }
    if (typeof day !== 'string' || !DAY.test(day) || typeof downloads !== 'number' || !Number.isInteger(downloads) || downloads < 0) return null
    rows[day] = downloads
  }
  return rows
}

/** One package's range from api.npmjs.org. Every call is a fresh request: nothing is cached by the app. */
export async function fetchRange(name: string, runDate: Day, signal?: AbortSignal): Promise<RangeResult> {
  const got = await timedFetch(rangeUrl(name, runDate), NPM_TIMEOUT_MS, signal)
  if (!('res' in got)) return { name, status: 'failed', reason: got.timedOut ? 'timeout' : 'network' }
  if (got.res.status === 404) return { name, status: 'failed', reason: 'not-found' }
  if (!got.res.ok) return { name, status: 'failed', reason: 'bad-response' }
  const rows = parseRows(await got.res.json().catch(() => null))
  return rows ? { name, status: 'ok', rows } : { name, status: 'failed', reason: 'bad-response' }
}

/** One package's stable releases from the function. Anything but a well-formed ok answer is `failed`. */
export async function fetchReleases(name: string, signal?: AbortSignal): Promise<ReleasesResult> {
  const failed: ReleasesResult = { name, status: 'failed', releases: [] }
  const got = await timedFetch(`/api/releases?name=${encodeURIComponent(name)}`, RELEASES_TIMEOUT_MS, signal)
  if (!('res' in got) || !got.res.ok) return failed
  const body = (await got.res.json().catch(() => null)) as { status?: unknown; releases?: unknown } | null
  if (body?.status !== 'ok' || !Array.isArray(body.releases)) return failed
  const releases: Release[] = []
  for (const item of body.releases) {
    const { day, version } = (item ?? {}) as { day?: unknown; version?: unknown }
    if (typeof day !== 'string' || !DAY.test(day) || typeof version !== 'string') return failed
    releases.push({ day, version })
  }
  return { name, status: 'ok', releases }
}
