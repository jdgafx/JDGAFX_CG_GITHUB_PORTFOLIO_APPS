// Shared request guards for the VoxAI Netlify functions: origin allow-list,
// best-effort per-IP throttling, body size limits and a single place to shape
// error responses so upstream vendor text never reaches the browser.

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

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
function originAllowed(origin: string | null): boolean {
  if (!origin) return true
  return allowedOrigins().includes(origin.replace(/\/$/, ''))
}

// Best-effort per-instance throttle. Netlify may run many warm instances, so
// this is a cost guard rather than a hard quota.
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function rateLimited(req: Request): boolean {
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

// Error bodies carry the run's trace when there is one, so the browser can mark
// the step that failed. Vendor text never goes in them.
export function jsonError(
  message: string,
  status: number,
  origin: string | null,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ error: message, ...extra }, { status, headers: corsHeaders(origin) })
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

// Reads the body as text only when it fits the limit. The declared length is checked
// first, so an oversize declaration is refused without reading anything. The measured
// length is checked after the read, because a client can declare one size and send
// another. The whole body is read before it is measured, so memory use is bounded by
// Netlify's request ceiling (about 6 MB), not by this limit. Returns null when the
// body is too large.
export async function readLimitedText(req: Request, limitBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > limitBytes) return null
  const text = await req.text()
  return new TextEncoder().encode(text).byteLength > limitBytes ? null : text
}

// The body as a JSON object, or the reason it was refused. A JSON value that is not an
// object reads as an object with no fields, so each handler's field checks refuse it.
export type JsonBody = { ok: true; fields: Record<string, unknown> } | { ok: false; reason: 'too-large' | 'not-json' }

export async function readJsonBody(req: Request, limitBytes: number): Promise<JsonBody> {
  const raw = await readLimitedText(req, limitBytes)
  if (raw === null) return { ok: false, reason: 'too-large' }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'not-json' }
  }
  return { ok: true, fields: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {} }
}

// Maps an upstream failure onto a status the browser can act on, without
// leaking the vendor's error text. Detail is logged server-side by the caller.
export function upstreamStatus(status: number): number {
  if (status === 429) return 429
  if (status >= 500) return 503
  return 502
}

// Plain-language copy for an upstream HTTP failure. The status code alone picks
// the wording; the provider's own text is never shown.
export function providerFailure(service: string, status: number): string {
  if (status === 401 || status === 402) return `${service} rejected the key or is out of credit.`
  if (status === 429) return 'Rate limited, try again in a minute.'
  if (status >= 500) return `${service} did not answer in time.`
  return `${service} did not accept the request (HTTP ${status}).`
}

// A fetch that the deadline aborted. The runtime may name the abort either way,
// and the only abort this server makes is its own deadline.
export function isDeadlineError(err: unknown): boolean {
  const name = typeof err === 'object' && err !== null && 'name' in err ? err.name : undefined
  return name === 'TimeoutError' || name === 'AbortError'
}
