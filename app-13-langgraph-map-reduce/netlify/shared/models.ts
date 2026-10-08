/** Per-node model settings. Prices are OpenRouter list prices in USD per 1M tokens, checked 2026-10-08. */

/** Extract: many cheap calls, one per chunk. $0.018 in / $0.09 out. */
export const EXTRACT_MODEL = 'openai/gpt-oss-20b'
/** Check: one cheap call that reviews the summary against the key points. $0.14 in / $0.28 out. */
export const CHECK_MODEL = 'xiaomi/mimo-v2.6-flash'
/** Synthesize: the one stronger call that writes the cited summary. $0.10 in / $0.50 out. */
export const SYNTH_MODEL = '~anthropic/claude-haiku-latest'

export interface Price {
  inPerM: number
  outPerM: number
}

export const PRICES: Readonly<Record<string, Price>> = {
  [EXTRACT_MODEL]: { inPerM: 0.018, outPerM: 0.09 },
  [CHECK_MODEL]: { inPerM: 0.14, outPerM: 0.28 },
  [SYNTH_MODEL]: { inPerM: 0.1, outPerM: 0.5 },
}

export interface RoleSettings {
  model: string
  maxTokens: number
  temperature: number
  /** Ask for a JSON object. Off for extract and check, which are read tolerantly instead. */
  jsonMode: boolean
  /** OpenRouter reasoning option. Only the synthesis call sends one. */
  reasoning?: Record<string, unknown>
  /** Route only to providers that accept every parameter sent. Only the synthesis call sets it. */
  requireParameters?: boolean
}

/** Extract sends no JSON-mode, reasoning or provider option. Its reply is read tolerantly. */
export const EXTRACT: RoleSettings = { model: EXTRACT_MODEL, maxTokens: 400, temperature: 0.2, jsonMode: false }
/** Check sends no JSON-mode, reasoning or provider option either. A failure here never discards the summary. */
export const CHECK: RoleSettings = { model: CHECK_MODEL, maxTokens: 300, temperature: 0, jsonMode: false }
export const SYNTH: RoleSettings = {
  model: SYNTH_MODEL,
  maxTokens: 900,
  temperature: 0.2,
  jsonMode: true,
  reasoning: { enabled: false },
  requireParameters: true,
}

/** Chunk calls that run at once. The rest wait in a queue inside the request. */
export const EXTRACT_CONCURRENCY = 4
/** The graph's own cycle: missing chunks are re-run at most this many times. */
export const MAX_RETRIES = 1
/** Pause before each retry call. The retry calls run together, so the pause is paid once. */
export const RETRY_PAUSE_MS = 1_500
