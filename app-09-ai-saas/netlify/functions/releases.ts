import { isPackageName } from '../../shared/packageName'
import { originAllowed } from '../shared/boundary'
import { withDeadline } from '../shared/deadline'
import { USER_AGENT } from '../shared/openrouter'
import { readTime } from '../shared/timeExtractor'

export const config = { path: '/api/releases' }

const REGISTRY = 'https://registry.npmjs.org'
const TIMEOUT_MS = 15_000
/** A cap on what is read, far above the largest document seen (64.7 MB). */
const MAX_BYTES = 250_000_000
const KEEP_DAYS = 400
const DAY_MS = 86_400_000

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

const NO_CACHE = { 'Cache-Control': 'no-store' }
/** One cache entry per package name: the CDN keys on the `name` query parameter. */
const CACHED = {
  'Netlify-CDN-Cache-Control': 'public, s-maxage=600',
  'Netlify-Vary': 'query=name',
  'Cache-Control': 'public, max-age=300',
}

interface Release { day: string; version: string }

/** Stable versions (no `-`) released in the last 400 days, oldest first. Null when there is no `time` object. */
function stableReleases(time: Record<string, unknown> | null, now: number): Release[] | null {
  if (typeof time !== 'object' || time === null || Array.isArray(time)) return null
  const cutoff = new Date(now - KEEP_DAYS * DAY_MS).toISOString().slice(0, 10)
  const found: Array<Release & { at: number }> = []
  for (const [version, stamp] of Object.entries(time)) {
    if (version === 'created' || version === 'modified' || version.includes('-') || typeof stamp !== 'string') continue
    const at = Date.parse(stamp)
    if (Number.isNaN(at)) continue
    const day = new Date(at).toISOString().slice(0, 10)
    if (day >= cutoff) found.push({ day, version, at })
  }
  found.sort((a, b) => a.at - b.at || (a.version < b.version ? -1 : 1))
  return found.map(({ day, version }) => ({ day, version }))
}

/**
 * GET /api/releases?name=<one package>: its stable release days from the npm registry (a fixed host). A failure
 * answers `status: 'failed'` and is never cached, so the page can say the history is unavailable.
 */
export default async function handler(req: Request): Promise<Response> {
  if (!originAllowed(req)) return json({ error: 'Origin not allowed.' }, 403, NO_CACHE)
  if (req.method !== 'GET') return json({ error: 'Use GET.' }, 405, NO_CACHE)
  const name = new URL(req.url).searchParams.get('name')
  if (!isPackageName(name)) return json({ error: 'A valid npm package name is required.' }, 400, NO_CACHE)
  const failed = () => json({ name, status: 'failed', releases: [] }, 200, NO_CACHE)
  try {
    const time = await withDeadline(TIMEOUT_MS, async (signal) => {
      const response = await fetch(`${REGISTRY}/${name.replace('/', '%2F')}`, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal,
      })
      if (!response.ok || !response.body) return null
      return readTime(response.body, MAX_BYTES)
    })
    const releases = stableReleases(time, Date.now())
    return releases ? json({ name, status: 'ok', releases }, 200, CACHED) : failed()
  } catch {
    return failed()
  }
}
