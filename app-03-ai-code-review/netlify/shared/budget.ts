// The time budget of the three function requests of one review: pass 1 (the review), then read 1 and read 2 of pass 2 side
// by side. Each request is its own function invocation with its own clock, so each must finish inside the platform's cut-off
// on its own. They no longer share one deadline (that was failure class C8: one 25 s deadline for 20.6 s + 15.1 s of model time).
//
// Platform cut-off: 26 s. Sources: this app's own earlier header ("the platform's ~26 s cut-off", budget.ts before this change) and
// docs/2026-10-07-haiku-audit.md:61 ("the 26-second budget"). SYSTEM.md:37 says 30 s, but that figure comes from c-incidents.md
// (app-13), not from this site, and netlify.toml sets no function timeout. No run on this site has been seen to live past 26 s,
// and none has been proven to be cut at 30 s, so the smaller figure is used. Netlify's clock also counts cold start and the
// reply's trip, which `Run.started` does not, so every limit below leaves room under 26 s.
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
// A pass 1 may therefore take 24 s and a read 22 s: each is the longest a call may run while the reply is still sent inside 26 s
// (24 s + the 0.7 s margin + assembling leaves 1.3 s; a read has 3.3 s of margin because it has less to assemble).

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
 * The longest pass 1 may run, one function request of its own. Source: 24 s is under the 26 s platform cut-off less the 0.7 s
 * margin (above), and above the slowest of 11 measured thinking-on calls, 22.3 s (2026-10-12 live proofs). It is the one place
 * to change if cold starts need a wider margin.
 */
export const PASS1_LIMIT_MS = 24_000
/** The longest one batched read may run, one function request of its own. Source: the slowest of 12 batched reads was 14.0 s (2026-10-12), and the limit stays at the 22 s set for whole-list reads. */
export const READ_LIMIT_MS = 22_000

/** Pass 1, one request. p50 is the median and p95 the slowest of the 8 measured calls (see the header). */
export const PASS1: Pass = { p50: 17_500, p95: 22_300, limitMs: PASS1_LIMIT_MS }
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
