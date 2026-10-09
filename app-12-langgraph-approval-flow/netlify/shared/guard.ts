import { EDIT_LABELS_MAX, LABEL_MAX_LENGTH, NOTE_MAX_LENGTH, lengthOf } from '../../src/lib/limits'
import { PRIORITIES, type HumanAction, type HumanDecision, type Priority } from '../../src/types'

/** Request bodies larger than this are refused. A 6,000-character issue body is at most about 24 KB of UTF-8. */
export const MAX_BODY_BYTES = 32 * 1024
const RATE_LIMIT_PER_MINUTE = 20

const DEFAULT_ORIGINS = [
  'https://jdgafx-app-12-langgraph-approval-flow.netlify.app',
  'http://localhost:8888',
  'http://localhost:5173',
]

export const SERVER_ERROR = 'Something went wrong on the server. Please try again.'

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The origins allowed to call the functions: the live site, local dev, and ALLOWED_ORIGINS. */
export function allowedOrigins(): string[] {
  const extra = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  return [...DEFAULT_ORIGINS, ...extra]
}

export function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  })
}

/** A plain-language JSON error, shaped like every other error the functions return. */
export function fail(message: string, status: number, headers: Record<string, string> = {}): Response {
  return json({ success: false, error: message }, status, headers)
}

/** Refuses a request from an unknown origin (403) or with the wrong method (405). Null when it may proceed. */
export function checkRequest(req: Request, method: 'GET' | 'POST'): Response | null {
  const origin = req.headers.get('origin')
  if (origin && !allowedOrigins().includes(origin)) return fail('Origin not allowed.', 403)
  if (req.method !== method) return fail('Method not allowed.', 405, { Allow: method })
  return null
}

const buckets = new Map<string, { count: number; resetAt: number }>()

/**
 * Best-effort limit per client address. Each warm function instance keeps its own counter, so the
 * real limit scales with the number of instances. It blunts casual abuse of an open demo endpoint.
 */
export function rateLimit(key: string, now: number = Date.now()): { allowed: boolean; retryAfter: number } {
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 })
    if (buckets.size > 5000) {
      for (const [name, entry] of buckets) if (entry.resetAt <= now) buckets.delete(name)
    }
    return { allowed: true, retryAfter: 0 }
  }
  bucket.count += 1
  if (bucket.count > RATE_LIMIT_PER_MINUTE) {
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

/** Reads the body up to `maxBytes`, counting the bytes actually received. Null when the cap is passed. */
async function readCapped(req: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array()
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** The parsed JSON body, or a 413 or 400 response. The declared length is checked before any read. */
export async function readJsonBody(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, response: fail('Request is too large.', 413) }
  }
  const bytes = await readCapped(req, MAX_BODY_BYTES)
  if (bytes === null) return { ok: false, response: fail('Request is too large.', 413) }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown }
  } catch {
    return { ok: false, response: fail('Request body was not valid JSON.', 400) }
  }
}

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A thread id from a request, or null. Ids become storage keys, so only the generated form is accepted. */
export function threadIdFrom(value: unknown): string | null {
  return typeof value === 'string' && THREAD_ID.test(value) ? value : null
}

const ACTIONS: readonly HumanAction[] = ['approve', 'edit', 'reject']

/** The maintainer's decision from a resume body. Labels and priority count only for an edit. */
export function decisionFrom(body: unknown): Checked<HumanDecision> {
  const raw = isRecord(body) && isRecord(body.decision) ? body.decision : null
  const action = raw?.action
  if (typeof action !== 'string' || !ACTIONS.includes(action as HumanAction)) {
    return { ok: false, message: 'Choose approve, edit or reject.' }
  }
  const decision: HumanDecision = { action: action as HumanAction }

  if (decision.action === 'edit') {
    const labels = raw?.labels
    const shaped =
      Array.isArray(labels) &&
      labels.length >= 1 &&
      labels.length <= EDIT_LABELS_MAX &&
      labels.every((label) => typeof label === 'string' && label.trim() !== '' && lengthOf(label) <= LABEL_MAX_LENGTH)
    if (!shaped) return { ok: false, message: `Pick 1 to ${EDIT_LABELS_MAX} labels, each up to ${LABEL_MAX_LENGTH} characters. To apply none, reject instead.` }
    if (typeof raw?.priority !== 'string' || !PRIORITIES.includes(raw.priority as Priority)) {
      return { ok: false, message: `Choose a priority: ${PRIORITIES.join(', ')}.` }
    }
    decision.labels = [...new Set((labels as string[]).map((label) => label.trim()))]
    decision.priority = raw.priority as Priority
  }

  const note = raw?.note
  if (note !== undefined && note !== null) {
    if (typeof note !== 'string' || lengthOf(note) > NOTE_MAX_LENGTH) {
      return { ok: false, message: `The note must be ${NOTE_MAX_LENGTH} characters or fewer.` }
    }
    if (note.trim()) decision.note = note.trim()
  }
  return { ok: true, value: decision }
}
