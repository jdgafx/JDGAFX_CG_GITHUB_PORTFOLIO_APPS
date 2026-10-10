import type { CostSource } from './events'
import type { TokenUsage } from './openrouter'

/**
 * The one model every node uses, requested as the OpenRouter alias for the newest Claude Haiku. OpenRouter
 * answers with a concrete id (SERVED_MODEL today), and the page shows that id, never the alias.
 * Haiku 5.5 rejects a temperature, so no call sends one.
 */
export const NODE_MODEL = '~anthropic/claude-haiku-latest'

/** The concrete model OpenRouter answered with when this was written. Its list price is the one below. */
export const SERVED_MODEL = 'anthropic/claude-haiku-5.5'

export const MAX_TOKENS = { plan: 400, agent: 800, draft: 1200, critic: 400 } as const

/**
 * What one step needs, in ms: its p95 on 54 local runs with Haiku 5.5 on 2026-10-09, rounded up to the
 * next half second (plan p50 1.6 s, p95 3.8 s; agent 1.4 / 2.7; draft 1.7 / 3.6; critic 1.8 / 2.9, and 3.5 s
 * p95 on a 32-call check of the critic alone). The tools figure is a ceiling for the three Wikipedia calls in
 * parallel, which took 0.1 to 0.9 s. The graph reads these to decide whether another step fits in the budget.
 */
export const STEP_NEEDS_MS = { plan: 4_000, agent: 3_000, tools: 1_500, draft: 4_000, critic: 3_500 } as const

interface ListPrice {
  inPerMillion: number
  outPerMillion: number
}

/** List prices checked on 2026-10-09, keyed by the alias that is requested and the id that answers. */
const LIST_PRICES: Record<string, ListPrice> = {
  [NODE_MODEL]: { inPerMillion: 0.1, outPerMillion: 0.5 },
  [SERVED_MODEL]: { inPerMillion: 0.1, outPerMillion: 0.5 },
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
