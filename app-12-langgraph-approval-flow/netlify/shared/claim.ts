import type { KeyValueStore } from './store'

/**
 * A claim on a thread: one run at a time may start, resume or retry it, whichever function instance it
 * lands on. It is a blob at `claims/<threadId>` written with a condition, so of several callers racing for
 * it the store lets exactly one win. The value carries the time it was taken. A run that crashes never
 * releases its claim, so a claim older than the TTL is taken over, also with a condition on the tag it read.
 */
export const CLAIM_PREFIX = 'claims/'
/** The longest a claim holds. A run is over within its 25 s budget plus the final writes, so this leaves margin. */
export const CLAIM_TTL_MS = 60_000

export const THREAD_BUSY = 'Another maintainer is handling this thread. Refresh to see the result.'

export interface Claim {
  threadId: string
  /** Random per claim, so a release never removes a claim that someone else took over. */
  owner: string
}

const keyFor = (threadId: string) => `${CLAIM_PREFIX}${threadId}`

interface ClaimValue {
  owner: string
  at: number
}

function parse(raw: string): ClaimValue | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value === 'object' && value !== null) {
      const { owner, at } = value as Record<string, unknown>
      if (typeof owner === 'string' && typeof at === 'number') return { owner, at }
    }
  } catch {
    // An unreadable claim counts as expired below.
  }
  return null
}

/** True when a live claim exists: taken less than the TTL ago. */
export async function isClaimed(store: KeyValueStore, threadId: string, nowMs: number = Date.now()): Promise<boolean> {
  const raw = await store.get(keyFor(threadId))
  if (raw === undefined) return false
  const held = parse(raw)
  return held !== null && nowMs - held.at < CLAIM_TTL_MS
}

/** Takes the claim, or returns null when another run holds it. A claim older than the TTL is taken over. */
export async function claimThread(store: KeyValueStore, threadId: string, nowMs: number = Date.now()): Promise<Claim | null> {
  const owner = crypto.randomUUID()
  const value = JSON.stringify({ owner, at: nowMs } satisfies ClaimValue)
  if (await store.setIfNew(keyFor(threadId), value)) return { threadId, owner }
  const current = await store.getTagged(keyFor(threadId))
  if (!current) return claimThread(store, threadId, nowMs)
  const held = parse(current.value)
  if (held !== null && nowMs - held.at < CLAIM_TTL_MS) return null
  return (await store.setIfMatch(keyFor(threadId), value, current.etag)) ? { threadId, owner } : null
}

/** Gives the claim up. A claim that was taken over meanwhile is left alone. Never throws: the TTL ends a stuck one. */
export async function releaseClaim(store: KeyValueStore, claim: Claim): Promise<void> {
  try {
    const raw = await store.get(keyFor(claim.threadId))
    if (raw !== undefined && parse(raw)?.owner === claim.owner) await store.delete(keyFor(claim.threadId))
  } catch (err) {
    console.error(`GraphGate: could not release the claim on thread ${claim.threadId}`, err)
  }
}
