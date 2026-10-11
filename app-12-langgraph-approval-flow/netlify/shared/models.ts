/**
 * The one model every node calls: OpenRouter's alias for the newest Haiku, so no version is pinned here.
 * Each reply names the model that answered, and netlify/shared/newest-model.ts checks it against the list.
 * Price is USD per 1M tokens, from the OpenRouter list checked 2026-10-09.
 *
 * Haiku 5.5 has no temperature parameter, and with provider.require_parameters a request that sends one
 * fails with 404 "No endpoints found". So no call sends a temperature. It reasons by default and the
 * reasoning spends the output cap before the answer (measured: 134 to 221 of 300 tokens), so every call
 * turns reasoning off.
 */
export const MODEL = '~anthropic/claude-haiku-latest'

export const CLASSIFY_MAX_TOKENS = 400
export const REPLY_MAX_TOKENS = 500

interface Price {
  input: number
  output: number
}

/** Keyed by the served model id the price was measured for. The alias MODEL is not a served id, so it has no price. */
export const PRICES: Readonly<Record<string, Price>> = {
  'anthropic/claude-haiku-5.5': { input: 0.1, output: 0.5 },
}

/**
 * The estimated USD for one call, priced by the model that answered, or undefined when that model is unknown
 * or the reply named none. An unknown model is never priced at another model's rate.
 */
export function estimateCost(servedModel: string | null, promptTokens: number, completionTokens: number): number | undefined {
  if (servedModel === null || !Object.hasOwn(PRICES, servedModel)) return undefined
  const price = PRICES[servedModel] as Price
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000
}
