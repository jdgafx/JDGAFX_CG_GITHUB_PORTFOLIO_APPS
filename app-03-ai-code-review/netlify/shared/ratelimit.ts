import { MAX_BATCHES } from './batches'

// Best effort only: each warm function instance keeps its own counters, so the effective limit scales with instance count.
// Enough to blunt casual abuse of an unauthenticated demo endpoint; a shared store would be needed for a real quota.
//
// A review is counted once. Pass 1 counts one request. A read function counts a review's first request, whichever batch it is,
// and none of that review's others: the review's id (from the hand-off, in the query string) is remembered once admitted. A
// review the limit denied is never remembered, so every one of its batches is denied too, in any order. Every read request that
// the limit let through also counts against a ceiling of the most batches a review can make, so a hand-off replayed on its
// batches is still throttled. A denied request counts against nothing but the limit that denied it.

export const RATE_LIMIT_MAX = 20
export const READ_CEILING = RATE_LIMIT_MAX * MAX_BATCHES
const WINDOW_MS = 60_000

interface Bucket {
  count: number
  resetAt: number
  /** The reviews this counter has already admitted. */
  seen: Set<string>
}

const buckets = new Map<string, Bucket>()

function bucketFor(key: string, now: number): Bucket {
  const found = buckets.get(key)
  if (found && found.resetAt > now) return found
  const fresh: Bucket = { count: 0, resetAt: now + WINDOW_MS, seen: new Set() }
  buckets.set(key, fresh)
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
  }
  return fresh
}

export interface Verdict {
  allowed: boolean
  retryAfter: number
}

/** Counts one request against `key`, unless `review` is one this counter already admitted. */
function take(key: string, max: number, review: string | null, weight = 1): Verdict {
  const now = Date.now()
  const bucket = bucketFor(key, now)
  if (review !== null && bucket.seen.has(review)) return { allowed: true, retryAfter: 0 }
  bucket.count += weight
  // The tolerance is for the sum of fractions: three shards of a third add up to one review.
  if (bucket.count > max + 1e-9) return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) }
  if (review !== null) bucket.seen.add(review)
  return { allowed: true, retryAfter: 0 }
}

/** How many shards the review of a pass 1 request says it has: `?of=3`. One when it says nothing; null for anything else. */
export function shardCount(req: Request): number | null {
  const raw = new URL(req.url).searchParams.get('of')
  if (raw === null) return 1
  return /^\d{1,2}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : null
}

/** The review id a read request names in its query string, or null when it names none that could be one. */
export function reviewId(req: Request): string | null {
  const raw = new URL(req.url).searchParams.get('review')
  return raw !== null && /^[0-9a-f]{8,64}$/.test(raw) ? raw : null
}

/**
 * Whether this request may go on: `stage` is the function, `who` the client address, `review` the id of a read's review. A request of
 * pass 1 is one of `shards` that make up its review, and counts a share of it, so a review counts once however many shards it has.
 * The merge calls no model; it is held to the ceiling alone.
 */
export function checkRate(stage: 'review' | 'merge' | 'read-1' | 'read-2', who: string, review: string | null, shards = 1): Verdict {
  if (stage === 'review') return take(`${stage}:${who}`, RATE_LIMIT_MAX, null, 1 / shards)
  if (stage === 'merge') return take(`${stage}:${who}`, READ_CEILING, null)
  const counted = take(`${stage}:${who}`, RATE_LIMIT_MAX, review)
  return counted.allowed ? take(`${stage}:all:${who}`, READ_CEILING, null) : counted
}
