import type { CostSource } from './events'
import type { TokenUsage } from './openrouter'

/** Model per graph node. Prices below are list prices in USD per 1M tokens, checked 2026-10-08. */
export const PLAN_MODEL = 'xiaomi/mimo-v2.6-flash'
export const AGENT_MODEL = 'xiaomi/mimo-v2.6-pro'
export const DRAFT_MODEL = 'xiaomi/mimo-v2.6-pro'
export const CRITIC_MODEL = '~anthropic/claude-haiku-latest'

export const MAX_TOKENS = { plan: 400, agent: 800, draft: 1200, critic: 400 } as const
export const TEMPERATURE = 0.2

interface ListPrice {
  inPerMillion: number
  outPerMillion: number
}

const LIST_PRICES: Record<string, ListPrice> = {
  [PLAN_MODEL]: { inPerMillion: 0.14, outPerMillion: 0.28 },
  [AGENT_MODEL]: { inPerMillion: 0.44, outPerMillion: 0.87 },
  [CRITIC_MODEL]: { inPerMillion: 0.1, outPerMillion: 0.5 },
}

/** Rounds away floating-point noise from summed or estimated costs. */
export const round12 = (value: number) => Math.round(value * 1e12) / 1e12

export interface CallCost {
  cost: number
  source: CostSource
}

/**
 * The cost of one call. A cost OpenRouter reported wins. Otherwise the cost is estimated
 * from the list price and labelled as an estimate. With no price or no token counts the
 * answer is null, so the app never shows a number it did not get or compute.
 */
export function costFor(model: string, usage: TokenUsage): CallCost | null {
  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) {
    return { cost: usage.cost, source: 'usage' }
  }
  const price = LIST_PRICES[model]
  if (!price || usage.prompt_tokens === undefined || usage.completion_tokens === undefined) return null
  const raw =
    (usage.prompt_tokens * price.inPerMillion + usage.completion_tokens * price.outPerMillion) / 1_000_000
  return { cost: round12(raw), source: 'estimated' }
}
