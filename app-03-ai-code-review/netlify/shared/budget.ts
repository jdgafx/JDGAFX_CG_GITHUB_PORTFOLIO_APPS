// The time budget of the three function requests of one review: pass 1 (the review), then read 1 and read 2 of pass 2 side
// by side. Each request is its own function invocation with its own clock, so each must finish inside the platform's cut-off
// on its own. They no longer share one deadline (that was failure class C8: one 25 s deadline for 20.6 s + 15.1 s of model time).
//
// Platform cut-off: about 30 s, measured (.acceptance/dw/es/cutoff-probe-2026-10-12/). The 26 s figure this header used to give came
// from this app's earlier "~26 s" and docs/2026-10-07-haiku-audit.md:61, not from a measurement. Netlify's clock also counts cold
// start and the reply's trip, which `Run.started` does not. Parallel pass-1 calls after the first also wait 6.1 to 6.9 s for a function
// instance before the handler's clock starts (.acceptance/dw/es/app-03-prod-cause-2026-10-12/), and the browser aborts a request at 30 s,
// so PASS1_LIMIT_MS leaves room for that wait: 6.9 s + 21 s + 2 s margin stays under 30 s.
//
// Measured live with thinking ON (Decision FS), ~anthropic/claude-haiku-latest resolving to anthropic/claude-haiku-5.5,
// 4.5 to 4.9 ms per output token, 1,910 to 3,063 reasoning tokens in a pass 1:
//   SP2 round 2 local probe, 2026-10-12 (.acceptance/dw/es/app-03-ai-code-review-sp2-584931f-2026-10-12/probe-local-r1..3.json):
//     pass 1: 13.4 s, 17.5 s, 20.6 s (finish_reason stop each time); pass-2 reads: 7.0 s and 15.1 s
//   SP2 round 2 preview: 7 of 10 pass-1 calls ran past the old 16.4 s limit; pass-2 reads were cut at 8.7 to 11.5 s.
//   Split-fix live proof, 2026-10-12 (.acceptance/dw/es/app-03-split-fix-2026-10-12/, five runs through the three bundled
//     functions in the browser's order: createStore.ts, auth.py twice, mux.go and express response.js at 1,178 lines):
//     pass 1: 16.5, 17.5, 13.2, 18.7, 22.3 s; reads: 15.3, 20.4 (read 1 of createStore.ts hit its 5,000-token cap with 3,746 of
//     them spent thinking, finish_reason length), 13.4, 14.3, 6.8, 7.1, 17.7, 15.7, 11.1, 15.6 s
//   Together, 8 pass-1 calls and 12 reads: PASS1 p50 17.5 s, p95 22.3 s (the slowest seen).
//   That read 1 hit its 5,000-token cap with whole-comment-list thinking, so each read request now takes at most 4 comments
//   (netlify/shared/batches.ts), one request per batch. Batched live proof, 2026-10-12 (.acceptance/dw/es/app-03-batched-reads-2026-10-12/,
//   r1 twice and r2 once; 3 more pass-1 calls at 18.4, 16.2 and 18.7 s, so 11 in all, p50 17.5 s, slowest 22.3 s): 12 batched reads at
//   7.4, 9.7, 3.4, 3.6, 6.0, 7.7, 12.2, 14.0, 2.5, 4.4, 6.8 and 9.9 s, all finish_reason stop, 209 to 2,220 reasoning tokens.
//   PASS2 p50 7.1 s, p95 14.0 s (the slowest seen) are those 12 reads. Its limit stays 22 s, as set before batching.
//   SP2 round 3 (bb776d2): a whole-file pass 1 on mux.go ran past 24 s (replies of up to 4,684 tokens at 4.44 to 4.75 ms a token).
//   Pass 1 is therefore sharded by line range (shards.ts), and the numbers for PASS1 below are those of one shard. Sharded live proof,
//   2026-10-12 (.acceptance/dw/es/app-03-sharded-pass1-2026-10-12/, mux.go in 4 shards and createStore.ts in 3): shards at 7.1, 8.2,
//   8.8, 13.7 s and 12.0, 14.1, 19.6 s (all finish_reason stop, 1,006 to 3,492 reasoning tokens); 12 more reads at 3.2 to 11.1 s. Cap
//   on one shard's reply: SHARD_MAX_TOKENS below. PASS1 p50 12.0 s, p95 19.6 s (the slowest seen) are those 7 shard calls.
// A pass 1 may therefore take 21 s (it was 24 s until the instance wait above was found) and a read 22 s.

/** The platform's cut-off for one function invocation. See above for the source. */
export const PLATFORM_CUTOFF_MS = 26_000
/** What one request may use in all, from the first byte of the request to the reply. Under the platform cut-off. */
export const TOTAL_MS = 25_000
/** Kept back from the end for assembling and sending the reply. */
export const SAFETY_MS = 700

interface Pass {
  p50: number
  p95: number
  /** The most one call may take. A call past this is a provider hang, not a slow reply. */
  limitMs: number
}

/**
 * The longest pass 1 may run, one function request of its own. Source: 21 s plus the 6.9 s longest measured wait for a function
 * instance and a 2 s margin stays under the 30 s platform cut-off and the browser's 30 s abort (above). It is the one place to
 * change if cold starts need a wider margin.
 */
export const PASS1_LIMIT_MS = 21_000
/** The longest one batched read may run, one function request of its own. Source: the slowest of 12 batched reads was 14.0 s (2026-10-12), and the limit stays at the 22 s set for whole-list reads. */
export const READ_LIMIT_MS = 22_000

/** One shard of pass 1, one request each. p50 is the median and p95 the slowest of the 7 measured shard calls (see the header). */
export const PASS1: Pass = { p50: 12_000, p95: 19_600, limitMs: PASS1_LIMIT_MS }
/** One batched read of pass 2 (at most 4 comments), one request each: the median and the slowest of the 12 measured batched reads. */
export const PASS2: Pass = { p50: 7_100, p95: 14_000, limitMs: READ_LIMIT_MS }

/**
 * The limit for the next call, or null when it cannot be a useful attempt.
 * `remaining` is what is left of the request. A call needs at least its own healthy p50, otherwise it would only time out.
 */
export function callLimit(pass: Pass, remaining: number): number | null {
  const available = remaining - SAFETY_MS
  const limit = Math.min(pass.limitMs, available)
  return limit >= pass.p50 ? Math.floor(limit) : null
}

/**
 * Pass 1 is sharded by line range (shards.ts) so that no shard has more to write than it can finish inside PASS1_LIMIT_MS.
 * The measured rate of the model: 4.44 to 4.75 ms per completion token (SP2 round 3, 2026-10-12, replies of up to 4,684 tokens
 * took 21.5 s). A shard's reply is capped at the number of tokens that rate fits inside the limit, with 2 s kept for the prompt
 * and the first token: (21,000 - 2,000) / 4.75 = 4,000. A reply that reaches the cap is cut off and reported as
 * such for that shard alone; it is never left to run into the time limit and be lost with nothing to show.
 */
export const MS_PER_TOKEN_WORST = 4.75
export const SHARD_MAX_TOKENS = Math.floor((PASS1_LIMIT_MS - 2_000) / MS_PER_TOKEN_WORST / 100) * 100
