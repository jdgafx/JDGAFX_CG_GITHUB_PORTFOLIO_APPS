import type { AnswerInput } from './answer'

// Must stay >= the client's TOP_K in src/lib/constants.ts, or well-formed
// requests from our own UI would be rejected here.
const MAX_CHUNKS = Number(process.env.MAX_CHUNKS ?? 20)
const MAX_CHUNK_CHARS = Number(process.env.MAX_CHUNK_CHARS ?? 2000)
const MAX_QUESTION_CHARS = Number(process.env.MAX_QUESTION_CHARS ?? 2000)
const MAX_TITLE_CHARS = Number(process.env.MAX_TITLE_CHARS ?? 200)

const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 20)
export const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)

// Browser origins allowed to call this endpoint. Netlify injects URL /
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

export type Validation = { ok: true; value: AnswerInput } | { ok: false; status: number; message: string }

/** Checks the request body. Any `model` field the client sends is ignored. */
export function validate(body: unknown): Validation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, message: 'Request body must be a JSON object.' }
  }
  const b = body as Record<string, unknown>

  if (typeof b['question'] !== 'string' || b['question'].trim() === '') {
    return { ok: false, status: 400, message: 'A question is required.' }
  }
  if (b['question'].length > MAX_QUESTION_CHARS) {
    return { ok: false, status: 400, message: `The question must be ${MAX_QUESTION_CHARS} characters or fewer.` }
  }

  if (!Array.isArray(b['chunks'])) {
    return { ok: false, status: 400, message: 'chunks must be an array of document passages.' }
  }
  if (b['chunks'].length === 0) {
    return { ok: false, status: 400, message: 'No document passages were provided.' }
  }
  if (b['chunks'].length > MAX_CHUNKS) {
    return { ok: false, status: 413, message: `At most ${MAX_CHUNKS} document passages can be sent per question.` }
  }

  if (typeof b['documentTitle'] !== 'string' || b['documentTitle'].trim() === '') {
    return { ok: false, status: 400, message: 'A document title is required.' }
  }

  return {
    ok: true,
    value: {
      question: b['question'],
      // Truncate overly long passages to keep the prompt inside the token budget.
      chunks: b['chunks'].map(c => (typeof c === 'string' ? c.slice(0, MAX_CHUNK_CHARS) : '')),
      documentTitle: b['documentTitle'].slice(0, MAX_TITLE_CHARS),
    },
  }
}
