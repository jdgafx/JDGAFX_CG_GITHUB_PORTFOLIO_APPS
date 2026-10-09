/** Per-node model settings. Prices are OpenRouter list prices in USD per 1M tokens, checked 2026-10-08. */

/** Extract: many cheap calls, one per chunk. $0.05 in / $0.08 out. No reasoning, so the whole token cap goes to the answer. */
export const EXTRACT_MODEL = 'meta-llama/llama-3.1-8b-instruct'
/** Check: one cheap call that reviews the summary against the key points. $0.14 in / $0.28 out. */
export const CHECK_MODEL = 'xiaomi/mimo-v2.6-flash'
/** Synthesize: the one stronger call that writes the cited summary. $0.10 in / $0.50 out. */
export const SYNTH_MODEL = '~anthropic/claude-haiku-latest'

export interface Price {
  inPerM: number
  outPerM: number
}

export const PRICES: Readonly<Record<string, Price>> = {
  [EXTRACT_MODEL]: { inPerM: 0.05, outPerM: 0.08 },
  [CHECK_MODEL]: { inPerM: 0.14, outPerM: 0.28 },
  [SYNTH_MODEL]: { inPerM: 0.1, outPerM: 0.5 },
}

export interface RoleSettings {
  model: string
  maxTokens: number
  /** Left out when undefined. Synthesis sets none, because a temperature and require_parameters together reroute it. */
  temperature?: number
  /** Ask for a JSON object. Off for extract and check, which are read tolerantly instead. */
  jsonMode: boolean
  /** OpenRouter reasoning option. Synthesis and check turn reasoning off. */
  reasoning?: Record<string, unknown>
  /** Route only to providers that accept every parameter sent. Only the synthesis call sets it. */
  requireParameters?: boolean
}

/** Extract sends no JSON-mode, reasoning or provider option. Its reply is read tolerantly. */
export const EXTRACT: RoleSettings = { model: EXTRACT_MODEL, maxTokens: 800, temperature: 0.2, jsonMode: false }
/** Check turns reasoning off and sends no JSON-mode or provider option. A failure here never discards the summary. */
export const CHECK: RoleSettings = {
  model: CHECK_MODEL,
  maxTokens: 300,
  temperature: 0,
  jsonMode: false,
  reasoning: { enabled: false },
}
export const SYNTH: RoleSettings = {
  model: SYNTH_MODEL,
  maxTokens: 1_200,
  jsonMode: true,
  reasoning: { enabled: false },
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
/** The graph's own cycle: missing chunks are re-run at most this many times. */
export const MAX_RETRIES = 1
/** Pause before each retry call. The retry calls run together, so the pause is paid once. */
export const RETRY_PAUSE_MS = 500
