import { NOTE_MAX_LENGTH, ticketProblem, TICKET_RULE } from '../../src/lib/limits'
import type { HumanAction, HumanDecision } from '../../src/types'

/** Request bodies larger than this are refused. A 2,000-character ticket is far smaller. */
export const MAX_BODY_BYTES = 16 * 1024
export const RATE_LIMIT_PER_MINUTE = 20

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

/** The ticket text from a start request body. */
export function ticketFrom(body: unknown): Checked<string> {
  if (!isRecord(body) || typeof body.ticket !== 'string') return { ok: false, message: TICKET_RULE }
  const problem = ticketProblem(body.ticket)
  return problem ? { ok: false, message: problem } : { ok: true, value: body.ticket.trim() }
}

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A thread id from a request, or null. Ids become storage keys, so only the generated form is accepted. */
export function threadIdFrom(value: unknown): string | null {
  return typeof value === 'string' && THREAD_ID.test(value) ? value : null
}

const ACTIONS: readonly HumanAction[] = ['approve', 'edit', 'reject']

/** The human decision from a resume body. An amount counts only for an edit. */
export function decisionFrom(body: unknown): Checked<HumanDecision> {
  const raw = isRecord(body) && isRecord(body.decision) ? body.decision : null
  const action = raw?.action
  if (typeof action !== 'string' || !ACTIONS.includes(action as HumanAction)) {
    return { ok: false, message: 'Choose approve, edit or reject.' }
  }
  const decision: HumanDecision = { action: action as HumanAction }

  if (decision.action === 'edit') {
    const amount = raw?.amount
    const cents = typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : NaN
    if (typeof amount !== 'number' || !(amount > 0) || Math.abs(cents / 100 - amount) > 1e-9) {
      return { ok: false, message: 'Enter an amount greater than zero, with at most two decimals.' }
    }
    decision.amount = cents / 100
  }

  const note = raw?.note
  if (note !== undefined && note !== null) {
    if (typeof note !== 'string' || [...note].length > NOTE_MAX_LENGTH) {
      return { ok: false, message: `The note must be ${NOTE_MAX_LENGTH} characters or fewer.` }
    }
    if (note.trim()) decision.note = note.trim()
  }
  return { ok: true, value: decision }
}
