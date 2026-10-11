// The time budget for the two model calls. One function invocation must finish inside the platform's ~26 s cut-off,
// so both passes share one deadline. Healthy latencies were measured live on anthropic/claude-haiku-5.5 (2026-10-09, 39
// complete runs on mux.go, auth.py, createStore.ts, express response.js, click utils.py and five pull requests):
//   pass 1 (review, ~2,000 tokens out): p50 9.3 s, p95 11.1 s, max 13.7 s (the limit below keeps the earlier 11.6 s p95)
//   pass 2 (two reads side by side; each ~1,000 tokens out): per read p50 6.3 s, p95 9.4 s, max 9.8 s (the largest file, express
//   response.js at 1,179 lines, needs ~9 s a read and, after a 12 s pass 1, is held to what is left of the run)
//   both together: p50 17.6 s, p95 24.3 s, max 24.5 s on that file; typical files 15 to 21 s
// Thinking is on (Decision FS, 2026-10-11), and no run has been measured with it. The figures above are the thinking-off
// ones, so each pass is given the time its thinking costs, estimated from the same runs: pass 1 emits about 2,000 tokens in 9.3 s
// and a pass 2 read about 1,000 in 6.3 s, about 3 ms per output token, so about 500 thinking tokens (the usual amount) add about
// 1.5 s to a p50 and up to 800 add about 2.5 s to a p95:
//   pass 1: p50 9.4 s -> 11.0 s, p95 11.6 s -> 14.1 s
//   pass 2 read: p50 6.3 s -> 7.9 s, p95 9.4 s -> 11.9 s
// Re-measure these live and replace them. A call may take 1.5 times its healthy p95 before it counts as a provider hang.
// The run's own deadline is not raised: typical runs (about 19 s) fit, but a run whose two passes both land near p95 (about
// 26 s) no longer fits in 25 s. Its pass 2 is then cut to what is left and its comments are shown as not confirmed.

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

export const PASS1: Pass = { p50: 11_000, p95: 14_100, limitMs: 21_150 }
export const PASS2: Pass = { p50: 7_900, p95: 11_900, limitMs: 17_850 }

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
