/**
 * The one model every node uses: extract, check, synthesis and the retry. It is pinned to the version named
 * in the project decision, not to the family alias. Settings differ per role only by token cap and JSON mode.
 */
export const MODEL = 'anthropic/claude-haiku-5.5'

export interface Price {
  inPerM: number
  outPerM: number
}

/** OpenRouter list price in USD per 1M tokens, read from the cost OpenRouter reported for two live calls, 2026-10-09. */
export const PRICES: Readonly<Record<string, Price>> = {
  [MODEL]: { inPerM: 0.1, outPerM: 0.5 },
}

/**
 * No role sends a temperature: Haiku 5.5 rejects one when every parameter must be honoured (404 "No endpoints
 * found"). Every role turns reasoning off. Left on, Haiku spent 380 to 475 hidden tokens of a 1,200-token
 * synthesis call on reasoning, so the JSON was cut off, and a synthesis call took 4 to 6 s instead of 3 s.
 */
export interface RoleSettings {
  model: string
  maxTokens: number
  /** Ask for a JSON object. Off for extract and check, which are read tolerantly instead. */
  jsonMode: boolean
  /** OpenRouter reasoning option. */
  reasoning: Record<string, unknown>
  /** Route only to providers that accept every parameter sent. Only the synthesis call sets it. */
  requireParameters?: boolean
}

const NO_REASONING = { enabled: false }

/** Extract sends no JSON-mode or provider option. Its reply is read tolerantly. */
export const EXTRACT: RoleSettings = { model: MODEL, maxTokens: 800, jsonMode: false, reasoning: NO_REASONING }
/** Check asks for a JSON object: without it Haiku wrote a chunk-by-chunk review in prose and hit the cap. A failure here never discards the summary. */
export const CHECK: RoleSettings = { model: MODEL, maxTokens: 300, jsonMode: true, reasoning: NO_REASONING }
export const SYNTH: RoleSettings = {
  model: MODEL,
  maxTokens: 1_500,
  jsonMode: true,
  reasoning: NO_REASONING,
  requireParameters: true,
}

/** Chunk calls that run at once. 12 is the chunk cap, so every chunk runs together. Any beyond the limit wait in a queue. */
export const EXTRACT_CONCURRENCY = 12
/**
 * The coverage retry starts only when at least this much of the run budget is left. A retry needs a
 * pause, a model call and a second synthesis and check, so a shorter remainder would only run out.
 */
export const MIN_RETRY_BUDGET_MS = 11_000
/**
 * After the retry's extract calls, a second synthesis and check run only when at least this much of the
 * budget is left. Below it the first-pass summary is kept.
 */
export const MIN_RESYNTH_BUDGET_MS = 6_000
/** The retry pass's extract calls normally take 1 to 3 s, so a call that hangs is cut off sooner than a first-pass call. */
export const RETRY_CALL_TIMEOUT_MS = 5_000
/**
 * A first-pass extract call took 2.3 s at the median and 3.9 s at the 95th percentile over 84 live calls, and never more
 * than 4.6 s unless it hung until the 10 s limit. 6 s leaves a hung call 4 s less of the budget, so the retry can still run.
 */
export const EXTRACT_CALL_TIMEOUT_MS = 6_000
/** The review call is advisory and takes about 1 to 2 s, so a slow one is cut off sooner than a call the summary depends on. */
export const CHECK_CALL_TIMEOUT_MS = 5_000
/** The graph's own cycle: missing chunks are re-run at most this many times. */
export const MAX_RETRIES = 1
/** Pause before each retry call. The retry calls run together, so the pause is paid once. */
export const RETRY_PAUSE_MS = 500
