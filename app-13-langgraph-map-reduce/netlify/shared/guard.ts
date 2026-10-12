import { EMPTY_MESSAGE, MAX_CHARS, MIN_CHARS, RANGE_MESSAGE } from '../../src/lib/limits'
import type { Chunk, Finding, Merged } from '../../src/types/frames'
import { splitText } from './chunk'
import { HANDOFF_REFUSED, openHandoffFull } from './handoff'
import { mergeFindings } from './merge'
import { MAX_ENTITIES, MAX_ENTITY_CHARS, MAX_POINTS, MAX_POINT_CHARS } from './parse'

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

/**
 * The origin a request was sent to, read from the request's own URL, or null when the URL does not parse. A deploy
 * preview's function gets its preview origin here, which the list above does not carry. Browsers set Origin, so a
 * cross-site page cannot make it match.
 */
export function requestOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
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

/** What request 2 starts from: the chunks the server splits itself, and the findings and merge it rebuilds from the signed key points. */
export interface Resume {
  chunks: Chunk[]
  findings: Finding[]
  merged: Merged
  /** Chunks request 1 already asked a second time. Request 2 starts its retry counter spent when there are any. */
  retried: number[]
}

export type SynthesizeBodyResult = { ok: true; text: string; resume: Resume } | { ok: false; status: number; error: string }

const refuse = (): SynthesizeBodyResult => ({ ok: false, status: 400, error: HANDOFF_REFUSED })

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Field check for POST /api/synthesize: the text, as for /api/run, and the signed hand-off request 1 made. The browser is not
 * trusted, so first the seal must be this server's and the hash in it must be the hash of this very text (handoff.ts), which
 * keeps a client from inventing key points or pairing real ones with another text. Then nothing in the hand-off is taken as
 * signed either, since a bug on the other side would sign it too: the chunks are the server's own split of the text, every
 * chunk number must be one of them, once, in order, every point id must be the id its position gives ("2.3" is the third point
 * of chunk 2), every point and entity must fit the limits an extraction reply is held to, and the findings are rebuilt from the
 * point texts and merged again, and the result must equal what was sent. Entities and the finding count are never read from
 * the body.
 */
export function validateSynthesizeBody(body: unknown, apiKey: string, now: number = Date.now()): SynthesizeBodyResult {
  const checked = validateRunBody(body)
  if (!checked.ok) return checked
  const opened = openHandoffFull(apiKey, checked.text, (body as { handoff?: unknown }).handoff, now)
  const resume = opened ? rebuild(checked.text, opened.merged, opened.retried) : null
  return resume ? { ok: true, text: checked.text, resume } : refuse()
}

/** The chunks, findings and merge a signed hand-off stands for, rebuilt and checked field by field, or null when anything is off. */
function rebuild(text: string, sent: unknown, sentRetried: unknown): Resume | null {
  if (!isRecord(sent) || !Array.isArray(sent.byChunk)) return null
  const chunks = splitText(text)
  const known = new Set(chunks.map((c) => c.id))
  if (!Array.isArray(sentRetried) || sentRetried.length > chunks.length || !sentRetried.every((id): id is number => typeof id === 'number' && known.has(id))) return null
  if (sent.byChunk.length < 1 || sent.byChunk.length > chunks.length) return null

  const findings: Finding[] = []
  let previous = 0
  for (const entry of sent.byChunk as unknown[]) {
    if (!isRecord(entry)) return null
    const chunkId = entry.chunkId
    if (typeof chunkId !== 'number' || !Number.isInteger(chunkId) || !known.has(chunkId) || chunkId <= previous) return null
    previous = chunkId
    const points = entry.points
    const entities = entry.entities
    if (!Array.isArray(points) || points.length < 1 || points.length > MAX_POINTS) return null
    if (!Array.isArray(entities) || entities.length > MAX_ENTITIES) return null
    const texts: string[] = []
    for (const [i, point] of (points as unknown[]).entries()) {
      if (!isRecord(point) || typeof point.text !== 'string' || point.id !== `${chunkId}.${i + 1}`) return null
      if (!point.text.trim() || point.text.length > MAX_POINT_CHARS) return null
      texts.push(point.text)
    }
    const names = entities as unknown[]
    if (!names.every((name): name is string => typeof name === 'string' && name.length <= MAX_ENTITY_CHARS)) return null
    findings.push({ chunkId, points: texts, entities: names, model: null, usage: null })
  }

  const merged = mergeFindings(findings)
  const same = merged.byChunk.every((chunk, i) => {
    const claimed = (sent.byChunk as Array<{ points: Array<{ text: string }>; entities: string[] }>)[i]
    return claimed !== undefined && chunk.points.length === claimed.points.length && chunk.points.every((p, j) => p.text === claimed.points[j]?.text) && chunk.entities.length === claimed.entities.length && chunk.entities.every((name, j) => name === claimed.entities[j])
  })
  if (merged.byChunk.length !== sent.byChunk.length || !same) return null
  return { chunks, findings, merged, retried: sentRetried as number[] }
}
