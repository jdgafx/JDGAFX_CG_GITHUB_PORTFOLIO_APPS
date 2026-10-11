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
/** Live summaries used 875 to 1,209 tokens, plus about 500 of thinking. */
export const SYNTH: RoleSettings = {
  model: MODEL,
  maxTokens: 3_500,
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
/** The graph's own cycle: missing chunks are re-run at most this many times. */
export const MAX_RETRIES = 1
/** Pause before each retry call. The retry calls run together, so the pause is paid once. */
export const RETRY_PAUSE_MS = 500
