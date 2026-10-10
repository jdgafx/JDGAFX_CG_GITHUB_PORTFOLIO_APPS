import type { TraceRow, Usage } from '../../src/types/frames'
import type { PriceList } from './prices'

/** The price fields of a call row. */
export type CallPrice = Pick<TraceRow, 'priceState' | 'cost' | 'rate'>

/**
 * Prices one answered call: its prompt and completion tokens times the served model's OpenRouter price per token,
 * rounded to 12 decimals to remove floating-point noise. A reply that named no model gets no price. A list that
 * could not be read, a served model it does not carry, or incomplete token counts make the price unavailable.
 * There is no other price to fall back on.
 */
export function priceCall(list: PriceList | null, servedModel: string | null, usage: Usage | null): CallPrice {
  if (!servedModel) return { priceState: 'no-served-model' }
  const rate = list?.get(servedModel)
  if (!rate || usage?.prompt_tokens === undefined || usage.completion_tokens === undefined) return { priceState: 'unavailable' }
  const raw = usage.prompt_tokens * rate.prompt + usage.completion_tokens * rate.completion
  return { priceState: 'priced', cost: Math.round(raw * 1e12) / 1e12, rate }
}
