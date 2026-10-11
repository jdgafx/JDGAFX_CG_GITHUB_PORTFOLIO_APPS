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
 * What one step needs, in ms. The base is the p95 on 54 local runs with Haiku 5.5 on 2026-10-09, rounded up
 * to the next half second, measured with thinking off (plan p50 1.6 s, p95 3.8 s; agent 1.4 / 2.7; draft
 * 1.7 / 3.6; critic 1.8 / 2.9, and 3.5 s p95 on a 32-call check of the critic alone). Thinking is on now, and
 * about 500 reasoning tokens at roughly 170 tokens a second add 3 s to each model step, so each model step
 * needs 3 s more than it did: plan 4 to 7 s, agent 3 to 6 s, draft 4 to 7 s, critic 3.5 to 6.5 s. That is an
 * estimate, not a new measurement. The tools figure is a ceiling for the three Wikipedia calls in parallel,
 * which took 0.1 to 0.9 s, and has no model in it. The graph reads these to decide whether another step fits
 * in the budget.
 */
export const STEP_NEEDS_MS = { plan: 7_000, agent: 6_000, tools: 1_500, draft: 7_000, critic: 6_500 } as const

/** Rounds away floating-point noise from costs and their sums. */
export const round12 = (value: number) => Math.round(value * 1e12) / 1e12
