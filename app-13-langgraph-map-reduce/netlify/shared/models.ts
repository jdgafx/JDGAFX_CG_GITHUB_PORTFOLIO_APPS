/**
 * The one model every node requests: extract, check, synthesis and the retry. It is the OpenRouter alias for
 * the newest Claude Haiku. OpenRouter answers with a concrete id, which the page shows and which is priced from
 * OpenRouter's model list, never the alias. Settings differ per role only by token cap and JSON mode.
 */
export const MODEL = '~anthropic/claude-haiku-latest'

/**
 * No role sends a temperature: Haiku 5.5 rejects one when every parameter must be honoured (404 "No endpoints
 * found"). No role sends a reasoning option, so Haiku thinks by its default. Thinking tokens count toward
 * max_tokens, and Haiku spent 380 to 475 of them on a 1,200-token synthesis call, so every cap below leaves room
 * for about 500 thinking tokens on top of the answer. Thinking also adds about 2.5 s to a call (see the time limits).
 * The reply's reasoning text is never read: only the message content is parsed.
 */
export interface RoleSettings {
  model: string
  maxTokens: number
  /** Ask for a JSON object. Off for extract and check, which are read tolerantly instead. */
  jsonMode: boolean
  /** Route only to providers that accept every parameter sent. Only the synthesis call sets it. */
  requireParameters?: boolean
}

/** Extract sends no JSON-mode or provider option. Its reply is read tolerantly. Live replies used up to 495 tokens, plus about 500 of thinking. */
export const EXTRACT: RoleSettings = { model: MODEL, maxTokens: 2_500, jsonMode: false }
/** Check asks for a JSON object: without it Haiku wrote a chunk-by-chunk review in prose and hit the cap. The reply is about 12 tokens, so the cap is almost all thinking room. A failure here never discards the summary. */
export const CHECK: RoleSettings = { model: MODEL, maxTokens: 2_000, jsonMode: true }
/**
 * Live summaries (SP2 8adcac0, r1-c to r3-c) used 2,523 to 3,383 completion tokens in all, of which 1,693 were thinking
 * in the one call that reported it. The cap was 3,500, so the largest call used 97% of it, and the three slowest calls
 * were the three largest. The cap is 4,200 so a longer answer is not cut off with finish_reason length (24% above the largest
 * seen); it is also about what the synthesis timeout allows at the measured 283 tokens per second (SYNTH_CALL_TIMEOUT_MS).
 * It is not a cap on thinking, and thinking is never limited here. The writer cites chunk numbers; a prompt that made it cite
 * key point ids took 12.6 to 17.5 s, aborted at 16.0 s and 21.0 s, and once spent all 4,500 tokens thinking (the points-fix
 * captures, app-13-points-fix-2026-10-12/synth-*.json and superseded-prompt-v1/), so which key points a sentence states is
 * judged afterwards (ATTRIBUTE) in small calls that cannot run away.
 */
export const SYNTH: RoleSettings = {
  model: MODEL,
  maxTokens: 4_200,
  jsonMode: true,
  requireParameters: true,
}

/** Chunk calls that run at once. 12 is the chunk cap, so every chunk runs together. Any beyond the limit wait in a queue. */
export const EXTRACT_CONCURRENCY = 12
/**
 * The coverage retry starts only when at least this much of the run budget is left. A retry needs a
 * pause, a model call and a second synthesis and check, so a shorter remainder would only run out:
 * 0.5 s pause + about 5.5 s for a retry extract call + MIN_RESYNTH_BUDGET_MS + 1 s of margin.
 */
export const MIN_RETRY_BUDGET_MS = 17_000
/**
 * After the retry's extract calls, a second synthesis and check run only when at least this much of the
 * budget is left: a synthesis call (about 6.6 s at the median with thinking) plus a check (about 3.6 s).
 * Below it the first-pass summary is kept.
 */
export const MIN_RESYNTH_BUDGET_MS = 10_000
/**
 * Timeouts below are the thinking-off live figures (extract p50 2.3 s, p95 3.9 s, max 4.6 s; check p50 1.1 s, p95 2.0 s;
 * synthesis p50 4.1 s, p95 7.0 s) plus about 2.5 s of thinking per call, the middle of the 1 to 3 s that 380 to 475
 * thinking tokens added to a synthesis call. They are estimates until re-measured live.
 *
 * The retry pass's extract calls normally take 3.5 to 5.5 s, so a call that hangs is cut off sooner than a first-pass call.
 */
export const RETRY_CALL_TIMEOUT_MS = 8_000
/**
 * A first-pass extract call is estimated at 4.8 s at the median, 6.4 s at the 95th percentile and 7.1 s at most unless it hangs.
 * 9 s covers that with 2 s to spare, and still leaves a hung call 3 s less of the budget than the 12 s synthesis limit.
 */
export const EXTRACT_CALL_TIMEOUT_MS = 9_000
/** The review call is advisory and is estimated at 3.6 s at the median and 4.5 s at the 95th percentile, so a slow one is cut off sooner than a call the summary depends on. */
export const CHECK_CALL_TIMEOUT_MS = 7_000
/**
 * Synthesis timeout. SP2 8adcac0 measured synthesis at 9,167 to 11,972 ms over 8 preview runs (median 9,803 ms; the three
 * slowest, 11,972, 11,927 and 11,770 ms, were within 0.23 s of the old 12,000 ms limit), at about 283 completion tokens per
 * second with thinking on; the points-fix run r1-a took 10,359 ms. 15 s is 3 s past the slowest call seen. Synthesis runs in
 * request 2 (split, extract and reduce are request 1), whose RUN_BUDGET_MS is 23 s, so a synthesis that takes the whole 15 s
 * still leaves 8 s: the attribution calls (ATTRIBUTE_CALL_TIMEOUT_MS, 7 s, plus the 1 s margin) always have their time. In one
 * request with extract (EXTRACT_PHASE_MAX_MS, 5.6 s) they would not: 5.6 + 15 + 6.4 = 27 s, and even a typical run,
 * 5.6 + 10.4 + 5.4 + 3.3 = 24.7 s, would have no room for the review.
 */
export const SYNTH_CALL_TIMEOUT_MS = 15_000
/** The longest extract phase in SP2 8adcac0: the slowest chunk, r3-c chunk 6, answered in 5,615 ms and all chunks run together. Request 1 is this long, plus the split. */
export const EXTRACT_PHASE_MAX_MS = 5_615
/**
 * One attribution call per chunk, all together, after synthesis: each judges the finished sentences against at most 6 key
 * points. Measured in the points-fix captures: the prototype ran 9 calls in 3,709 ms wall, the slowest 3,674 ms (590
 * completion tokens, 519 of them thinking); in the full run r1-a the 9 calls took 1,243 to 5,388 ms. Thinking is on and
 * unlimited; the cap leaves three times the largest answer seen. The limit is 7 s, 1.3 times the slowest call.
 */
export const ATTRIBUTE: RoleSettings = { model: MODEL, maxTokens: 1_800, jsonMode: true }
export const ATTRIBUTE_CALL_TIMEOUT_MS = 7_000
/** Attribution starts only with this much of the run budget left: the slowest call seen (5,388 ms) plus CHECK_BUDGET_MARGIN_MS. */
export const MIN_ATTRIBUTE_BUDGET_MS = 6_400
/**
 * The review runs only when at least this much of the run budget is left: the slowest review seen was 3,416 ms (SP2
 * 8adcac0, r1-d) plus CHECK_BUDGET_MARGIN_MS. With less, the review is skipped and the summary is returned without it.
 */
export const MIN_CHECK_BUDGET_MS = 4_500
/** The review call is cut off this long before the run budget ends, so the budget never expires inside it and discards a finished summary. */
export const CHECK_BUDGET_MARGIN_MS = 1_000
/** The graph's own cycle: missing chunks are re-run at most this many times. */
export const MAX_RETRIES = 1
/** Pause before each retry call. The retry calls run together, so the pause is paid once. */
export const RETRY_PAUSE_MS = 500

/**
 * Request 1 retries a chunk whose extract came back with nothing usable only when this much of its budget is left: the pause,
 * the retry call's own limit (so even a hung call ends inside the budget) and 1 s of margin. Request 1's extract phase took
 * 2,876 to 7,280 ms in the points-fix runs (slowest single call 5,615 ms in SP2), so 15.7 s or more were left after it.
 */
export const MIN_EXTRACT_RETRY_BUDGET_MS = RETRY_PAUSE_MS + RETRY_CALL_TIMEOUT_MS + 1_000
