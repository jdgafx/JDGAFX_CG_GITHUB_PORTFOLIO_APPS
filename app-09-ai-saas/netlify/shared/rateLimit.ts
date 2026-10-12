export const RATE_LIMIT_MAX = 20
export const RATE_LIMIT_WINDOW_MS = 60_000

export interface Limit {
  allowed: boolean
  /** Whole seconds until the client's window ends. */
  retryAfter: number
}

/**
 * A per-client fixed window. Best effort: each warm function instance keeps its own counter, so the effective limit
 * scales with the instance count. It blunts casual abuse of an unauthenticated endpoint; a real quota needs a shared store.
 */
export function createRateLimiter(max = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS, now: () => number = Date.now): (key: string) => Limit {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  return (key) => {
    const at = now()
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= at) {
      buckets.set(key, { count: 1, resetAt: at + windowMs })
      if (buckets.size > 5000) {
        for (const [k, v] of buckets) if (v.resetAt <= at) buckets.delete(k)
      }
      return { allowed: true, retryAfter: 0 }
    }
    bucket.count += 1
    return bucket.count > max ? { allowed: false, retryAfter: Math.ceil((bucket.resetAt - at) / 1000) } : { allowed: true, retryAfter: 0 }
  }
}

/** Who is asking: Netlify's client address, else the first forwarded address, else one shared bucket. */
export function clientKey(req: Request): string {
  return req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}
