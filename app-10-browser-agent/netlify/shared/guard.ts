/** Production site and local dev origins that may call the billable endpoints. */
const PRODUCTION_ORIGIN = 'https://jdgafx-app-10-browser-agent.netlify.app'
const LOCAL_ORIGINS = ['http://localhost:8888', 'http://localhost:5173']

/** A request body that cannot be used. The message is curated copy. */
export class BodyError extends Error {}

// Origins allowed to call the billable endpoints. Netlify injects URL and DEPLOY_* for the live
// site and deploy previews, so only the production host is spelled out here.
export function allowedOrigins(): string[] {
  const configured = process.env.ALLOWED_ORIGINS?.split(',') ?? []
  return [
    ...configured,
    process.env.URL ?? '',
    process.env.DEPLOY_PRIME_URL ?? '',
    process.env.DEPLOY_URL ?? '',
    PRODUCTION_ORIGIN,
    ...LOCAL_ORIGINS,
  ]
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

// Requests without an Origin header are not browser cross-site traffic (curl, server-to-server),
// so they pass without an echo header. The per-IP limit below is the guard that applies to them.
export function originAllowed(origin: string | null): boolean {
  if (!origin) return true
  return allowedOrigins().includes(origin.replace(/\/$/, ''))
}

/** Echoes the Origin only when it is allowed. A wildcard would let any site spend the budget. */
export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (origin && originAllowed(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

const buckets = new Map<string, { count: number; resetAt: number }>()

/**
 * Best-effort per-instance throttle. Netlify can run many warm instances, so this is a cost
 * guard against runaway calls, not a hard quota.
 */
export function rateLimited(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now()
  for (const [name, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(name)
  }
  const bucket = buckets.get(key)
  if (!bucket) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  bucket.count += 1
  return bucket.count > max
}

export function clientKey(req: Request): string {
  return req.headers.get('x-nf-client-connection-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown'
}

export function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

/**
 * Reads a JSON body under a byte cap. A declared length over the cap is refused before the body
 * is read. The bytes actually read are checked as well, because a length header can be missing.
 */
export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > maxBytes) throw new BodyError('The request is too large.')
  const text = await req.text()
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new BodyError('The request is too large.')
  try {
    return JSON.parse(text)
  } catch {
    throw new BodyError('The request body is not valid JSON.')
  }
}
