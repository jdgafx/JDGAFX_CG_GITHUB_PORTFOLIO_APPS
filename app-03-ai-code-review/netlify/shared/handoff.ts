import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Handoff, ShardNote, Ticket } from './wire'
import type { ReviewInput } from './pipeline'

// Server only (node:crypto): the browser never imports this file.
//
// The read requests carry the first pass's comments from the browser, which is not trusted. Pass 1 therefore signs what it
// found together with a hash of the exact code it read, and a read request only proceeds when the signature is the server's
// and the hash matches the code in that same request. No secret to configure: the key is derived from the provider key, which
// never leaves the server, under a label of its own.
//
// The record is made for one moment and one request each: it carries the time it was made and expires after three minutes, and
// each read request has a seal of its own that binds the record to that function (read 1 or read 2) and that batch, so a ticket
// for one request does not open another.

const VERSION = 2
/** More comments than the first pass can write; a larger list is not a hand-off this server made. */
const MAX_COMMENTS = 200
/** How long a hand-off is good for. A review's reads start within seconds of pass 1; three minutes leaves room for a slow network. */
export const HANDOFF_MAX_AGE_MS = 180_000
/** A hand-off dated this far ahead of the clock was not made by this server. */
const CLOCK_SKEW_MS = 5_000

export const HANDOFF_REFUSED = 'The first pass does not match this code, or its record was changed, so the second pass was refused. Run the review again.'
export const HANDOFF_EXPIRED = 'The first pass is more than 3 minutes old, so the second pass was refused. Run the review again.'

export type ReadStage = 'read-1' | 'read-2'

/** SHA-256 of the exact input the first pass read: the file's lines and language, or each pull request file's path, status and patch. */
export function contentHash(input: ReviewInput): string {
  const canonical = input.kind === 'file' ? ['file', input.lang, input.lines] : ['pr', input.files.map((f) => [f.path, f.status, f.patch])]
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/** The MAC of `text` for one purpose: the review as a whole, or one read request (its function and batch). */
const macOf = (apiKey: string, purpose: string, text: string): string => {
  const key = createHmac('sha256', apiKey).update(`codelens-handoff-v${VERSION}`).digest()
  return createHmac('sha256', key).update(`${purpose}\n${text}`).digest('hex')
}

/** The review's id, derived from the signed text: the rate limit's key, and what a read request must name to be counted as that review. */
export const reviewIdOf = (apiKey: string, text: string): string => macOf(apiKey, 'review', text).slice(0, 32)

const purposeOf = (stage: ReadStage, batch: number) => `${stage}:${batch}`

/**
 * Signs the raw first-pass comments and the batches of their ids, with the hash of the code they were written for and the time.
 * Returns the text, a seal for each read request (a function and a batch), and an id for the review (for the rate limit).
 */
export function makeHandoff(apiKey: string, input: ReviewInput, comments: unknown[], batches: number[][], iat = Date.now(), shards: ShardNote[] = []): Handoff {
  const text = JSON.stringify({ v: VERSION, iat, hash: contentHash(input), comments, batches, shards })
  const seals = (stage: ReadStage) => batches.map((_, batch) => macOf(apiKey, purposeOf(stage, batch), text))
  return { id: reviewIdOf(apiKey, text), text, seals: { 'read-1': seals('read-1'), 'read-2': seals('read-2') } }
}

/**
 * The record of one shard of pass 1, signed for that shard of that review: the raw comments it wrote for its range, the hash of
 * the code and the time. The merge request carries these back and reads nothing it did not sign.
 */
export function makeShardRecord(apiKey: string, input: ReviewInput, index: number, count: number, comments: unknown[], iat = Date.now()): Ticket {
  const text = JSON.stringify({ v: VERSION, kind: 'shard', iat, hash: contentHash(input), index, count, comments })
  return { text, seal: macOf(apiKey, `shard:${index}`, text) }
}

/** The comments of a shard record this server signed for exactly this input and this shard, within three minutes. */
export function openShardRecord(apiKey: string, input: ReviewInput, value: unknown, index: number, count: number, now = Date.now()): unknown[] | 'expired' | null {
  const t = value as Partial<Ticket> | null
  if (!t || typeof t.text !== 'string' || typeof t.seal !== 'string') return null
  const expected = Buffer.from(macOf(apiKey, `shard:${index}`, t.text), 'hex')
  const given = Buffer.from(t.seal, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  let body: { v?: unknown; kind?: unknown; iat?: unknown; hash?: unknown; index?: unknown; count?: unknown; comments?: unknown }
  try {
    body = JSON.parse(t.text) as typeof body
  } catch {
    return null
  }
  if (body.v !== VERSION || body.kind !== 'shard' || body.hash !== contentHash(input) || body.index !== index || body.count !== count) return null
  if (typeof body.iat !== 'number' || !Number.isFinite(body.iat) || body.iat > now + CLOCK_SKEW_MS) return null
  if (now - body.iat > HANDOFF_MAX_AGE_MS) return 'expired'
  if (!Array.isArray(body.comments) || body.comments.length > MAX_COMMENTS) return null
  return body.comments
}

export interface Opened {
  /** The review's id: the one a read request must name in its query string. */
  id: string
  comments: unknown[]
  /** The ids of the comments that passed the checks, in the batches pass 1 made. */
  batches: number[][]
}

/**
 * The raw comments and batches of a ticket this server signed for exactly this input, this function and this batch, no more than
 * three minutes ago. 'expired' for one that was good once; null for anything else.
 */
export function openHandoff(apiKey: string, input: ReviewInput, value: unknown, stage: ReadStage, batch: number, now = Date.now()): Opened | 'expired' | null {
  const t = value as Partial<Ticket> | null
  if (!t || typeof t.text !== 'string' || typeof t.seal !== 'string') return null
  const expected = Buffer.from(macOf(apiKey, purposeOf(stage, batch), t.text), 'hex')
  const given = Buffer.from(t.seal, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  let body: { v?: unknown; iat?: unknown; hash?: unknown; comments?: unknown; batches?: unknown }
  try {
    body = JSON.parse(t.text) as typeof body
  } catch {
    return null
  }
  if (body.v !== VERSION || body.hash !== contentHash(input)) return null
  if (typeof body.iat !== 'number' || !Number.isFinite(body.iat) || body.iat > now + CLOCK_SKEW_MS) return null
  if (now - body.iat > HANDOFF_MAX_AGE_MS) return 'expired'
  if (!Array.isArray(body.comments) || body.comments.length > MAX_COMMENTS) return null
  const batches = body.batches
  if (!Array.isArray(batches) || !batches.every((b) => Array.isArray(b) && b.every((id) => Number.isInteger(id)))) return null
  return { id: reviewIdOf(apiKey, t.text), comments: body.comments, batches: batches as number[][] }
}
