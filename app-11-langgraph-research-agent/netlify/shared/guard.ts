import { isRecord } from './json'

export const QUESTION_MAX_CHARS = 500
export const MAX_BODY_BYTES = 8 * 1024
export const RATE_LIMIT_MAX = 20
export const RATE_LIMIT_WINDOW_MS = 60_000

const DEFAULT_ORIGINS = [
  'https://jdgafx-app-11-langgraph-research-agent.netlify.app',
  'http://localhost:8888',
  'http://localhost:5173',
]

export const TOO_LARGE_MESSAGE = 'The request is too large.'
export const NOT_JSON_MESSAGE = 'The request body must be JSON.'

/** The default origins plus any listed in the ALLOWED_ORIGINS variable, comma separated. */
export function allowedOrigins(extra: string | undefined): string[] {
  const listed = (extra ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '')
  return [...DEFAULT_ORIGINS, ...listed]
}

/** A request with no Origin header passes; a browser request must come from the allowlist. */
export function originAllowed(origin: string | null, allowed: string[]): boolean {
  return !origin || allowed.includes(origin)
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

export function clientKey(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

export interface RateCheck {
  allowed: boolean
  retryAfterSec: number
}

/**
 * Best effort, per warm instance: each instance keeps its own counts. It blunts casual
 * abuse of an open demo endpoint and is not a quota.
 */
export function createRateLimiter(max = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS) {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  return {
    check(key: string, now: number): RateCheck {
      const bucket = buckets.get(key)
      if (!bucket || bucket.resetAt <= now) {
        if (buckets.size > 5000) {
          for (const [name, entry] of buckets) if (entry.resetAt <= now) buckets.delete(name)
        }
        buckets.set(key, { count: 1, resetAt: now + windowMs })
        return { allowed: true, retryAfterSec: 0 }
      }
      bucket.count += 1
      if (bucket.count > max) {
        return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) }
      }
      return { allowed: true, retryAfterSec: 0 }
    },
  }
}

export type BodyResult = { ok: true; value: unknown } | { ok: false; status: number; message: string }

/** Reads the body with a declared-size check and a measured byte cap, then parses it as JSON. */
export async function readJsonBody(req: Request, maxBytes: number = MAX_BODY_BYTES): Promise<BodyResult> {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > maxBytes) return { ok: false, status: 413, message: TOO_LARGE_MESSAGE }
  if (!req.body) return { ok: false, status: 400, message: NOT_JSON_MESSAGE }

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      return { ok: false, status: 413, message: TOO_LARGE_MESSAGE }
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown }
  } catch {
    return { ok: false, status: 400, message: NOT_JSON_MESSAGE }
  }
}

export type QuestionResult = { ok: true; question: string } | { ok: false; message: string }

/** Checks the question field: text, trimmed, 1 to 500 characters. */
export function validateQuestion(body: unknown): QuestionResult {
  if (!isRecord(body) || typeof body.question !== 'string') {
    return { ok: false, message: 'The request needs a question field with text.' }
  }
  const question = body.question.trim()
  const length = Array.from(question).length
  if (length < 1 || length > QUESTION_MAX_CHARS) {
    return { ok: false, message: `The question must be 1 to ${QUESTION_MAX_CHARS} characters.` }
  }
  return { ok: true, question }
}
