import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Handoff } from './wire'
import type { ReviewInput } from './pipeline'

// Server only (node:crypto): the browser never imports this file.
//
// The read requests carry the first pass's comments from the browser, which is not trusted. Pass 1 therefore signs what it
// found together with a hash of the exact code it read, and a read request only proceeds when the signature is the server's
// and the hash matches the code in that same request. No secret to configure: the key is derived from the provider key, which
// never leaves the server, under a label of its own.

const VERSION = 1
/** More comments than the first pass can write; a larger list is not a hand-off this server made. */
const MAX_COMMENTS = 200

export const HANDOFF_REFUSED = 'The first pass does not match this code, or its record was changed, so the second pass was refused. Run the review again.'

/** SHA-256 of the exact input the first pass read: the file's lines and language, or each pull request file's path, status and patch. */
export function contentHash(input: ReviewInput): string {
  const canonical = input.kind === 'file' ? ['file', input.lang, input.lines] : ['pr', input.files.map((f) => [f.path, f.status, f.patch])]
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

const macOf = (apiKey: string, text: string): string => {
  const key = createHmac('sha256', apiKey).update(`codelens-handoff-v${VERSION}`).digest()
  return createHmac('sha256', key).update(text).digest('hex')
}

/** Signs the raw first-pass comments and the batches of their ids, together with the hash of the code they were written for. */
export function makeHandoff(apiKey: string, input: ReviewInput, comments: unknown[], batches: number[][]): Handoff {
  const text = JSON.stringify({ v: VERSION, hash: contentHash(input), comments, batches })
  return { text, seal: macOf(apiKey, text) }
}

export interface Opened {
  comments: unknown[]
  /** The ids of the comments that passed the checks, in the batches pass 1 made. */
  batches: number[][]
}

/** The raw comments and batches of a hand-off this server signed for exactly this input, or null for anything else. */
export function openHandoff(apiKey: string, input: ReviewInput, value: unknown): Opened | null {
  const h = value as { text?: unknown; seal?: unknown } | null
  if (!h || typeof h.text !== 'string' || typeof h.seal !== 'string') return null
  const expected = Buffer.from(macOf(apiKey, h.text), 'hex')
  const given = Buffer.from(h.seal, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  let body: { v?: unknown; hash?: unknown; comments?: unknown; batches?: unknown }
  try {
    body = JSON.parse(h.text) as typeof body
  } catch {
    return null
  }
  if (body.v !== VERSION || body.hash !== contentHash(input)) return null
  if (!Array.isArray(body.comments) || body.comments.length > MAX_COMMENTS) return null
  const batches = body.batches
  if (!Array.isArray(batches) || !batches.every((b) => Array.isArray(b) && b.every((id) => Number.isInteger(id)))) return null
  return { comments: body.comments, batches: batches as number[][] }
}
