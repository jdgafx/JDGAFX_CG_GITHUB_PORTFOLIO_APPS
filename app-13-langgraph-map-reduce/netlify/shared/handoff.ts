import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Handoff, Merged } from '../../src/types/frames'

// Server only (node:crypto): the browser never imports this file.
//
// Request 2 gets the key points back from the browser, which is not trusted. It can re-derive chunk numbers and point ids, but
// not the point texts, so an unsigned hand-off would let a client invent key points that the summary presents as extracted from
// the document. Request 1 therefore signs the merged key points together with a hash of the exact text it read, and request 2
// only proceeds when the signature is the server's and the hash matches the text in that same request. No secret to configure:
// the key is derived from the provider key, which never leaves the server, under a label of its own (the app-03 approach).

const VERSION = 1
/** A seal older than this is refused. Request 2 follows request 1 within seconds, and request 3 within a minute. */
export const HANDOFF_MAX_AGE_MS = 5 * 60_000
/** A clock a little ahead of this server's is tolerated, a seal dated further ahead is not. */
const CLOCK_SKEW_MS = 60_000

/** Shown for any hand-off request 2 refuses: tampered points, another text, another key, or no hand-off at all. */
export const HANDOFF_REFUSED = 'The key points did not match this text, or they were changed. Run the analysis again.'

/** SHA-256 of the exact text request 1 read. */
export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** The seal of a hand-off body. Exported so a test can sign a body of its own. */
export function sealOf(apiKey: string, body: string): string {
  const key = createHmac('sha256', apiKey).update(`keypoints-handoff-v${VERSION}`).digest()
  return createHmac('sha256', key).update(body).digest('hex')
}

/** Signs the merged key points with the hash of the text they were extracted from and the time they were issued. */
export function makeHandoff(apiKey: string, text: string, merged: Merged, now: number = Date.now(), retried: number[] = []): Handoff {
  const body = JSON.stringify({ v: VERSION, hash: textHash(text), at: now, retried, merged })
  return { text: body, seal: sealOf(apiKey, body) }
}

/** The merged key points of a hand-off this server signed for exactly this text in the last 5 minutes, or null for anything else. */
export function openHandoff(apiKey: string, text: string, value: unknown, now: number = Date.now()): unknown {
  return openHandoffFull(apiKey, text, value, now)?.merged ?? null
}

/** The same, with the chunks request 1 already asked a second time (the seal covers them too), so request 2 does not ask a third. */
export function openHandoffFull(apiKey: string, text: string, value: unknown, now: number = Date.now()): { merged: unknown; retried: unknown } | null {
  const h = value as { text?: unknown; seal?: unknown } | null
  if (!h || typeof h !== 'object' || typeof h.text !== 'string' || typeof h.seal !== 'string') return null
  const expected = Buffer.from(sealOf(apiKey, h.text), 'hex')
  const given = Buffer.from(h.seal, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  let body: { v?: unknown; hash?: unknown; at?: unknown; retried?: unknown; merged?: unknown }
  try {
    body = JSON.parse(h.text) as typeof body
  } catch {
    return null
  }
  if (body.v !== VERSION || body.hash !== textHash(text)) return null
  if (typeof body.at !== 'number' || !Number.isFinite(body.at) || now - body.at > HANDOFF_MAX_AGE_MS || body.at - now > CLOCK_SKEW_MS) return null
  return body.merged == null ? null : { merged: body.merged, retried: body.retried }
}
