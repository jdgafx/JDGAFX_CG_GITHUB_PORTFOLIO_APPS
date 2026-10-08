import { DEFAULT_SITE_URL } from './provider'

/** Browser origins allowed to call the endpoint. The site's own origin always passes. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? [DEFAULT_SITE_URL, 'http://localhost:8888', 'http://localhost:5173'].join(','))
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

const MAX_BODY_BYTES = 8 * 1024
export const MAX_QUERY_CHARS = 500

// One request fans out to four model calls, so the ceiling is lower than a plain proxy
// needs. Best effort only: each warm function instance keeps its own counter.
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60_000
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

/** A problem with the request itself. Its message is safe to show the visitor. */
export class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'RequestError'
  }
}

export function rateLimit(key: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k)
    }
    return { allowed: true, retryAfter: 0 }
  }
  bucket.count += 1
  if (bucket.count > RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) }
  }
  return { allowed: true, retryAfter: 0 }
}

export function clientKey(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

/** The client-facing host, which is what the browser's Origin is built from. */
function requestHost(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  const host = req.headers.get('host')
  if (host) return host
  try {
    return new URL(req.url).host
  } catch {
    return ''
  }
}

/**
 * The allowlist exists to stop other sites using this endpoint, so it must never reject
 * the app's own page. Same-origin always passes, so deploy previews and custom domains
 * need no manual entry.
 */
export function isOriginAllowed(req: Request, origin: string | null): boolean {
  if (!origin) return true // non-browser client sends no Origin
  if (ALLOWED_ORIGINS.includes(origin)) return true
  try {
    return new URL(origin).host === requestHost(req)
  } catch {
    return false
  }
}

export function corsHeaders(req: Request, origin: string | null): Record<string, string> {
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (origin && isOriginAllowed(req, origin)) {
    base['Access-Control-Allow-Origin'] = origin
  }
  return base
}

export function fail(message: string, status: number, headers: Record<string, string>): Response {
  return new Response(message, { status, headers })
}

export function sseEvent(event: object): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/** Reads and validates the body. Only `query` is read; any model field the client sends is ignored. */
export async function readQuery(req: Request): Promise<string> {
  const raw = await req.text()
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    throw new RequestError(413, 'Request body too large.')
  }
  let body: { query?: unknown } | null
  try {
    body = JSON.parse(raw) as { query?: unknown } | null
  } catch {
    throw new RequestError(400, 'Invalid JSON.')
  }
  const query = typeof body?.query === 'string' ? body.query.trim() : ''
  if (!query) throw new RequestError(400, 'Missing query.')
  if (query.length > MAX_QUERY_CHARS) {
    throw new RequestError(400, `Query too long — ${MAX_QUERY_CHARS} characters max.`)
  }
  return query
}
