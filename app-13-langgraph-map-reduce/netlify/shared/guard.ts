import { EMPTY_MESSAGE, MAX_CHARS, MIN_CHARS, RANGE_MESSAGE } from '../../src/lib/limits'

const LIVE_ORIGIN = 'https://jdgafx-app-13-langgraph-map-reduce.netlify.app'
const LOCAL_ORIGINS = ['http://localhost:8888', 'http://localhost:5173']

export const MAX_BODY_BYTES = 256 * 1024

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

/** The live site and local dev servers, plus any extra origins from the ALLOWED_ORIGINS variable. */
export function allowedOrigins(extra: string | undefined): string[] {
  const listed = (extra ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  return [LIVE_ORIGIN, ...LOCAL_ORIGINS, ...listed]
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

// Best effort only: each warm function instance keeps its own counter, so the effective limit scales
// with the number of instances. Enough to blunt casual abuse of an open demo endpoint.
const buckets = new Map<string, { count: number; resetAt: number }>()

export interface RateCheck {
  allowed: boolean
  retryAfter: number
}

export function rateLimit(key: string, now: number): RateCheck {
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
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

export type BodyResult = { ok: true; value: unknown } | { ok: false; status: number; error: string }

/** Reads a JSON body under a byte cap. The declared length is checked first, then the bytes received. */
export async function readJsonBody(req: Request): Promise<BodyResult> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'Request is too large.' }
  }
  let bytes: ArrayBuffer
  try {
    bytes = await req.arrayBuffer()
  } catch {
    return { ok: false, status: 400, error: 'Request body could not be read.' }
  }
  if (bytes.byteLength > MAX_BODY_BYTES) return { ok: false, status: 413, error: 'Request is too large.' }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown }
  } catch {
    return { ok: false, status: 400, error: 'Request body was not valid JSON.' }
  }
}

export type TextResult = { ok: true; text: string } | { ok: false; status: number; error: string }

/** Field check for POST /api/run: text must be a string of 200 to 20,000 characters with some visible content. */
export function validateRunBody(body: unknown): TextResult {
  if (!body || typeof body !== 'object' || !('text' in body)) {
    return { ok: false, status: 400, error: 'Send a JSON object with a text field.' }
  }
  const text = (body as { text: unknown }).text
  if (typeof text !== 'string') return { ok: false, status: 400, error: 'The text field must be a string.' }
  if (text.length < MIN_CHARS || text.length > MAX_CHARS) return { ok: false, status: 400, error: RANGE_MESSAGE }
  if (!text.trim()) return { ok: false, status: 400, error: EMPTY_MESSAGE }
  return { ok: true, text }
}
