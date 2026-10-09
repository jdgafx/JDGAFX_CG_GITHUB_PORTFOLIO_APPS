// The time budget for the two model calls. One function invocation must finish inside the platform's ~26 s cut-off,
// so both passes share one deadline. Healthy latencies were measured live on anthropic/claude-haiku-5.5 (2026-10-09, 29
// complete runs on mux.go, auth.py, createStore.ts and four pull requests, 80 model calls in all):
//   pass 1 (review, ~2,000 tokens out): p50 9.3 s, p95 11.6 s, max 11.9 s
//   pass 2 (verdicts, ~1,000 tokens out): p50 5.2 s, p95 7.2 s, max 7.7 s
//   both together: p50 14.6 s, p95 18.0 s, max 19.1 s
// A call may take 1.5 times its healthy p95 before it counts as a provider hang.

/** What one run may use in all, from the first byte of the request to the reply. */
export const TOTAL_MS = 25_000
/** Kept back from the end for assembling and sending the reply. */
export const SAFETY_MS = 700

interface Pass {
  p50: number
  p95: number
  /** The most one call may take: about 1.5 times a healthy p95. A call past this is a provider hang, not a slow reply. */
  limitMs: number
}

export const PASS1: Pass = { p50: 9_500, p95: 11_600, limitMs: 17_400 }
export const PASS2: Pass = { p50: 5_000, p95: 7_200, limitMs: 10_800 }

/**
 * The limit for the next call, or null when it cannot be a useful attempt.
 * `remaining` is what is left of the run; `reserve` is what must stay for a later pass. A call needs at least its own
 * healthy p50, otherwise it would only time out and waste the time the later pass needs.
 */
export function callLimit(pass: Pass, remaining: number, reserve = 0): number | null {
  const available = remaining - SAFETY_MS - reserve
  const limit = Math.min(pass.limitMs, available)
  return limit >= pass.p50 ? Math.floor(limit) : null
}
