/**
 * The one model every node calls, and its list price. Chris named this version, so it is pinned here
 * and nowhere else: change MODEL to change every node. Price is USD per 1M tokens, from the OpenRouter
 * list checked 2026-10-09.
 *
 * Haiku 5.5 has no temperature parameter, and with provider.require_parameters a request that sends one
 * fails with 404 "No endpoints found". So no call sends a temperature. It reasons by default and the
 * reasoning spends the output cap before the answer (measured: 134 to 221 of 300 tokens), so every call
 * turns reasoning off.
 */
export const MODEL = 'anthropic/claude-haiku-5.5'

export const CLASSIFY_MAX_TOKENS = 300
export const REPLY_MAX_TOKENS = 500

interface Price {
  input: number
  output: number
}

export const PRICES: Readonly<Record<string, Price>> = {
  [MODEL]: { input: 0.1, output: 0.5 },
}

/** The estimated USD for one call, or undefined when the model has no known price. */
export function estimateCost(model: string, promptTokens: number, completionTokens: number): number | undefined {
  const price = PRICES[model] as Price | undefined
  if (!price) return undefined
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000
}
