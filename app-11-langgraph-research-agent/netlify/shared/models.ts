/**
 * The one model every node uses, requested as the OpenRouter alias for the newest Claude Haiku. OpenRouter
 * answers with a concrete id, and the page shows that id, never the alias. The price is read from OpenRouter
 * for that id (pricing.ts). Haiku 5.5 rejects a temperature, so no call sends one.
 */
export const NODE_MODEL = '~anthropic/claude-haiku-latest'

/**
 * Thinking is on, and thinking tokens count toward max_tokens. Haiku spends a few hundred to about 500
 * reasoning tokens on these tasks, so each cap is the old answer cap (plan 400, agent 800, draft 1200,
 * critic 400) plus 1,600 for thinking.
 */
export const MAX_TOKENS = { plan: 2000, agent: 2400, draft: 2800, critic: 2000 } as const

/**
 * What one step needs, in ms, measured on the preview on 2026-10-13 and rounded up: plan 1.4-1.6 s, agent
 * 1.5-3.6 s, draft 2.7-5.7 s, critic model call ~4.1 s, critic code check ~3 ms. The tools figure covers a
 * round that can include a web read (~3.7 s), where parallel Wikipedia calls took 0.04-0.15 s. The graph
 * reads these to decide whether another step fits in the budget.
 */
export const STEP_NEEDS_MS = { plan: 5_000, agent: 4_000, tools: 4_000, draft: 5_000, critic: 4_500 } as const

/** Rounds away floating-point noise from costs and their sums. */
export const round12 = (value: number) => Math.round(value * 1e12) / 1e12
