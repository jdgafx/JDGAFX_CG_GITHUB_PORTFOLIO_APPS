/**
 * Model ids for the three model calls in the graph, and the list prices used to estimate cost.
 * Prices are USD per 1M tokens, from the OpenRouter list checked 2026-10-08.
 */

/** Intake: reads the ticket and returns JSON facts. A cheap model is enough for extraction. */
export const INTAKE_MODEL = 'xiaomi/mimo-v2.6-flash'
/** Decide: writes the rationale for the policy's proposal. The policy sets the action and amount. */
export const DECIDE_MODEL = '~anthropic/claude-haiku-latest'
/** Reply: writes the customer email for the final decision. */
export const REPLY_MODEL = '~anthropic/claude-haiku-latest'

export const INTAKE_MAX_TOKENS = 300
export const DECIDE_MAX_TOKENS = 500
export const REPLY_MAX_TOKENS = 600

interface Price {
  input: number
  output: number
}

/**
 * List prices per 1M tokens. The graph calls only the three ids above. The others are listed
 * for comparison and are never called.
 */
export const PRICES: Readonly<Record<string, Price>> = {
  'xiaomi/mimo-v2.6-pro': { input: 0.44, output: 0.87 },
  'xiaomi/mimo-v2.6-flash': { input: 0.14, output: 0.28 },
  'openai/gpt-oss-20b': { input: 0.018, output: 0.09 },
  '~anthropic/claude-haiku-latest': { input: 0.1, output: 0.5 },
}

/** The estimated USD for one call, or undefined when the model has no known price. */
export function estimateCost(model: string, promptTokens: number, completionTokens: number): number | undefined {
  const price = PRICES[model] as Price | undefined
  if (!price) return undefined
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000
}
