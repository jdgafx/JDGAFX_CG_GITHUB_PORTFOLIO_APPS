// Shared request guards for the VoxAI Netlify functions: origin allow-list,
// best-effort per-IP throttling and a single place to shape error responses so
// upstream vendor text never reaches the browser.

const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 20)
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)

// Browser origins allowed to call these endpoints. Netlify injects URL /
// DEPLOY_PRIME_URL for the live site and deploy previews, so the deployed host
// never has to be hardcoded here.
function allowedOrigins(): string[] {
  const configured = process.env.ALLOWED_ORIGINS?.split(',') ?? []
  return [
    ...configured,
    process.env.URL ?? '',
    process.env.DEPLOY_PRIME_URL ?? '',
    process.env.DEPLOY_URL ?? '',
    'http://localhost:8888',
    'http://localhost:5173',
  ]
    .map(o => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (origin) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

// Requests without an Origin header are not browser cross-site traffic (curl,
// server-to-server), so they are allowed through without an echo header.
export function originAllowed(origin: string | null): boolean {
  if (!origin) return true
  return allowedOrigins().includes(origin.replace(/\/$/, ''))
}

// Best-effort per-instance throttle. Netlify may run many warm instances, so
// this is a cost guard rather than a hard quota.
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimited(req: Request): boolean {
  const key =
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'

  const now = Date.now()
  for (const [k, v] of rateBuckets) {
    if (v.resetAt <= now) rateBuckets.delete(k)
  }
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  bucket.count += 1
  return bucket.count > RATE_LIMIT_MAX
}

export function jsonError(
  message: string,
  status: number,
  origin: string | null,
): Response {
  return Response.json({ error: message }, { status, headers: corsHeaders(origin) })
}

// Runs the OPTIONS / origin / method / rate-limit gauntlet. Returns a Response
// to send back immediately, or null when the request may proceed.
export function guardRequest(req: Request): Response | null {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') {
    if (!originAllowed(origin)) return jsonError('Origin not allowed', 403, null)
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  if (!originAllowed(origin)) return jsonError('Origin not allowed', 403, null)
  if (req.method !== 'POST') return jsonError('Method not allowed', 405, origin)
  if (rateLimited(req)) {
    return jsonError('Too many requests. Wait a moment and try again.', 429, origin)
  }

  return null
}

// Maps an upstream failure onto a status the browser can act on, without
// leaking the vendor's error text. Detail is logged server-side by the caller.
export function upstreamStatus(status: number): number {
  if (status === 429) return 429
  if (status >= 500) return 503
  return 502
}
