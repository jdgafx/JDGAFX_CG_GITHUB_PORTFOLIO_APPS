import { SITE_URL } from './provider'

// Local dev servers: `vite` and `netlify dev`.
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:8888']

const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60_000

// Netlify injects URL, DEPLOY_PRIME_URL and DEPLOY_URL for the live site and
// deploy previews, so no preview host has to be listed here.
function allowedOrigins(): string[] {
  return [SITE_URL, process.env.DEPLOY_PRIME_URL ?? '', process.env.DEPLOY_URL ?? '', ...DEV_ORIGINS]
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  }
  if (origin) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

// Requests without an Origin header are not cross-site browser traffic, so they
// pass without an echo header.
export function originAllowed(origin: string | null): boolean {
  if (!origin) return true
  return allowedOrigins().includes(origin.replace(/\/$/, ''))
}

// Best-effort, per warm instance. Netlify may run several instances, so this is a
// cost guard rather than a hard quota. A five-stage run uses five calls.
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimited(key: string): boolean {
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

export function clientKey(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}
