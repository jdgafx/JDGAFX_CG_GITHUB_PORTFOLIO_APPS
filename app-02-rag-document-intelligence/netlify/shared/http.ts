import type { AnswerInput } from './answer'

// The browser sends at most TOP_K (20) passages, so this must stay at or above it.
const MAX_CHUNKS = 20
const MAX_CHUNK_CHARS = 2000
const MAX_QUESTION_CHARS = 2000
const MAX_TITLE_CHARS = 200

/** Largest request body accepted. A question with 20 passages of about 520 characters is about 12 KB. */
export const MAX_BODY_BYTES = 256 * 1024

const RATE_LIMIT_MAX = 20
export const RATE_LIMIT_WINDOW_MS = 60_000

export const RATE_LIMIT_MESSAGE = 'Rate limited, try again in a minute.'

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

// Requests without an Origin header are not browser cross-site traffic (curl,
// server-to-server), so they are allowed through.
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

type BodyRead = { ok: true; body: unknown } | { ok: false; status: number; message: string }

/**
 * Reads the body as JSON. The size is checked against the declared Content-Length
 * first, then against the bytes actually received, so a missing or wrong header
 * cannot get past the limit.
 */
export async function readJsonBody(req: Request): Promise<BodyRead> {
  const tooLarge: BodyRead = { ok: false, status: 413, message: 'The request is too large. Try a shorter question.' }
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return tooLarge

  let bytes: ArrayBuffer
  try {
    bytes = await req.arrayBuffer()
  } catch {
    return { ok: false, status: 400, message: 'The request body could not be read.' }
  }
  if (bytes.byteLength > MAX_BODY_BYTES) return tooLarge

  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) as unknown }
  } catch {
    return { ok: false, status: 400, message: 'Invalid JSON in request body.' }
  }
}

type Validation = { ok: true; value: AnswerInput } | { ok: false; status: number; message: string }

// The browser labels every passage "[Chunk N]:" with N as its position in the document.
const CHUNK_LABEL = /^\[Chunk (\d{1,6})\]:/

function reject(status: number, message: string): Validation {
  return { ok: false, status, message }
}

/** Checks the request body. Any `model` field the client sends is ignored. */
export function validate(body: unknown): Validation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return reject(400, 'Request body must be a JSON object.')
  }
  const b = body as Record<string, unknown>

  const question = b['question']
  if (typeof question !== 'string' || question.trim() === '') return reject(400, 'A question is required.')
  if (question.length > MAX_QUESTION_CHARS) {
    return reject(400, `The question must be ${MAX_QUESTION_CHARS} characters or fewer.`)
  }

  const passages = b['chunks']
  if (!Array.isArray(passages)) return reject(400, 'chunks must be an array of document passages.')
  if (passages.length === 0) return reject(400, 'No document passages were provided.')
  if (passages.length > MAX_CHUNKS) {
    return reject(413, `At most ${MAX_CHUNKS} document passages can be sent per question.`)
  }

  const chunks: string[] = []
  const chunkIndices: number[] = []
  for (const passage of passages as unknown[]) {
    if (typeof passage !== 'string') return reject(400, 'Each document passage must be text.')
    const label = CHUNK_LABEL.exec(passage)
    if (!label) return reject(400, 'Each document passage must start with its [Chunk N] label.')
    chunks.push(passage.slice(0, MAX_CHUNK_CHARS))
    chunkIndices.push(Number(label[1]))
  }

  const title = b['documentTitle']
  if (typeof title !== 'string' || title.trim() === '') return reject(400, 'A document title is required.')

  return {
    ok: true,
    value: { question, chunks, chunkIndices, documentTitle: title.slice(0, MAX_TITLE_CHARS) },
  }
}
