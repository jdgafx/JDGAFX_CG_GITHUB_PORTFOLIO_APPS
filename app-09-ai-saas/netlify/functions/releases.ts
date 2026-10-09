import { isValidPackageName } from '../shared/contract'
import { readTime, TooLargeError } from '../shared/timeExtractor'

export const config = { path: '/api/releases' }

const REGISTRY = 'https://registry.npmjs.org'
/** The registry documents of the busiest packages are tens of megabytes decoded; this is read as a stream and only `time` is kept. */
const MAX_BYTES = 250_000_000
const TIMEOUT_MS = 22_000

function json(status: number, body: unknown, cache = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache ? 'public, max-age=300' : 'no-store' },
  })
}

/**
 * GET /api/releases?name=<package>: the package's release dates from the npm registry (a fixed host), as `{ time }`. The
 * name is validated, the read has a byte cap and a time limit, and the browser never has to hold the whole document.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed. Use GET.', kind: 'unexpected' })
  const name = new URL(req.url).searchParams.get('name') ?? ''
  if (!isValidPackageName(name)) return json(400, { error: 'A valid npm package name is required.', kind: 'unexpected' })
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  try {
    const response = await fetch(`${REGISTRY}/${encodeURIComponent(name)}`, { signal: timeout, headers: { Accept: 'application/json' } })
    if (response.status === 404) return json(404, { error: `"${name}" is not on the npm registry.`, kind: 'not-found' })
    if (!response.ok || !response.body) return json(502, { error: `The npm registry answered with an error (HTTP ${response.status}).`, kind: 'unexpected' })
    const time = await readTime(response.body, MAX_BYTES)
    if (time === null) return json(502, { error: 'The npm registry sent a record with no release dates.', kind: 'unexpected' })
    return json(200, { time }, true)
  } catch (err) {
    if (err instanceof TooLargeError) return json(413, { error: err.message, kind: 'too-large' })
    if (timeout.aborted) return json(504, { error: `The npm registry did not answer within ${TIMEOUT_MS / 1000} seconds.`, kind: 'timeout' })
    console.error('releases function: read failed', err)
    return json(502, { error: 'Could not read the npm registry.', kind: 'network' })
  }
}
