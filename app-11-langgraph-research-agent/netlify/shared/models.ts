import type { CostSource } from './events'
import type { TokenUsage } from './openrouter'

/**
 * Model per graph node. Prices are list prices in USD per 1M tokens, checked 2026-10-08.
 */
/** plan: $0.14 in / $0.28 out */
export const PLAN_MODEL = 'xiaomi/mimo-v2.6-flash'
/** agent, which calls tools: $0.44 in / $0.87 out */
export const AGENT_MODEL = 'xiaomi/mimo-v2.6-pro'
/** draft: $0.44 in / $0.87 out */
export const DRAFT_MODEL = 'xiaomi/mimo-v2.6-pro'
/** critic, which returns a JSON verdict: $0.10 in / $0.50 out */
export const CRITIC_MODEL = '~anthropic/claude-haiku-latest'
/** Not used by any node in this app. Kept in the price table for the cost check: $0.018 in / $0.09 out */
export const GPT_OSS_20B_MODEL = 'openai/gpt-oss-20b'

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
  [GPT_OSS_20B_MODEL]: { inPerMillion: 0.018, outPerMillion: 0.09 },
}

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
  return { cost: Math.round(raw * 1e12) / 1e12, source: 'estimated' }
}
