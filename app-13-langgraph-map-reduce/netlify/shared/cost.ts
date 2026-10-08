import type { CostSource, Usage } from '../../src/types/frames'
import { PRICES } from './models'

export interface CostReading {
  cost: number
  source: CostSource
}

/**
 * Estimated cost in USD from list prices per 1M tokens. The division happens once, at the end,
 * and the result is rounded to 12 decimals to remove floating-point noise.
 */
export function estimateCost(model: string, usage: Usage): number | null {
  const price = PRICES[model]
  if (!price || usage.prompt_tokens === undefined || usage.completion_tokens === undefined) return null
  const raw = (usage.prompt_tokens * price.inPerM + usage.completion_tokens * price.outPerM) / 1_000_000
  return Math.round(raw * 1e12) / 1e12
}

/** The cost OpenRouter reported when it did, otherwise an estimate labelled as one. Null when neither exists. */
export function readCost(model: string, usage: Usage | null, reported: number | null): CostReading | null {
  if (reported !== null) return { cost: reported, source: 'usage' }
  if (!usage) return null
  const estimated = estimateCost(model, usage)
  return estimated === null ? null : { cost: estimated, source: 'estimated' }
}
