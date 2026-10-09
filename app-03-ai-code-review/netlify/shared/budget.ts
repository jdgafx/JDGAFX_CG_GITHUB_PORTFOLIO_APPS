// The time budget for the two model calls. One function invocation must finish inside the platform's ~26 s cut-off,
// so both passes share one deadline. Healthy latencies were measured live on anthropic/claude-haiku-5.5 (2026-10-09, 39
// complete runs on mux.go, auth.py, createStore.ts, express response.js, click utils.py and five pull requests):
//   pass 1 (review, ~2,000 tokens out): p50 9.3 s, p95 11.1 s, max 13.7 s (the limit below keeps the earlier 11.6 s p95)
//   pass 2 (two reads side by side; each ~1,000 tokens out): per read p50 6.3 s, p95 9.4 s, max 9.8 s (the largest file, express
//   response.js at 1,179 lines, needs ~9 s a read and, after a 12 s pass 1, is held to what is left of the run)
//   both together: p50 17.6 s, p95 24.3 s, max 24.5 s on that file; typical files 15 to 21 s
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

export const PASS1: Pass = { p50: 9_400, p95: 11_600, limitMs: 17_400 }
export const PASS2: Pass = { p50: 6_300, p95: 9_400, limitMs: 14_100 }

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
