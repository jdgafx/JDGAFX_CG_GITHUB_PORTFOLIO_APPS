const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 20)
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)

export type Gate = { ok: true; headers: Record<string, string> } | { ok: false; response: Response }

// Browser origins allowed to call these endpoints. Netlify injects URL and DEPLOY_PRIME_URL
// for the live site and deploy previews, so the deployed host is never hardcoded.
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

// A request with no Origin header is not browser cross-site traffic (curl, server to server).
function originAllowed(origin: string | null): boolean {
  if (!origin) return true
  return allowedOrigins().includes(origin.replace(/\/$/, ''))
}

function corsHeaders(origin: string | null, method: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': `${method}, OPTIONS`,
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (origin) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

export function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

// Best-effort per-instance throttle on the paid endpoints. Netlify runs many warm
// instances, so this is a cost guard, not a hard quota.
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function rateLimited(key: string): boolean {
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

function clientKey(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

// Origin check, CORS preflight, method check and (for POST) the rate limit, in one place.
export function gate(req: Request, method: 'GET' | 'POST'): Gate {
  const origin = req.headers.get('origin')
  if (!originAllowed(origin)) {
    return { ok: false, response: json({ error: 'Origin not allowed' }, 403, corsHeaders(null, method)) }
  }
  const headers = corsHeaders(origin, method)
  if (req.method === 'OPTIONS') return { ok: false, response: new Response(null, { status: 204, headers }) }
  if (req.method !== method) return { ok: false, response: json({ error: 'Method not allowed' }, 405, headers) }
  if (method === 'POST' && rateLimited(clientKey(req))) {
    return { ok: false, response: json({ error: 'Too many requests. Wait a minute and try again.' }, 429, headers) }
  }
  return { ok: true, headers }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return undefined
  }
}
