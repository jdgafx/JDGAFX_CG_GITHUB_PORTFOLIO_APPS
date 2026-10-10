/**
 * The one model every node uses, requested as the OpenRouter alias for the newest Claude Haiku. OpenRouter
 * answers with a concrete id, and the page shows that id, never the alias. The price is read from OpenRouter
 * for that id (pricing.ts). Haiku 5.5 rejects a temperature, so no call sends one.
 */
export const NODE_MODEL = '~anthropic/claude-haiku-latest'

export const MAX_TOKENS = { plan: 400, agent: 800, draft: 1200, critic: 400 } as const

/**
 * What one step needs, in ms: its p95 on 54 local runs with Haiku 5.5 on 2026-10-09, rounded up to the
 * next half second (plan p50 1.6 s, p95 3.8 s; agent 1.4 / 2.7; draft 1.7 / 3.6; critic 1.8 / 2.9, and 3.5 s
 * p95 on a 32-call check of the critic alone). The tools figure is a ceiling for the three Wikipedia calls in
 * parallel, which took 0.1 to 0.9 s. The graph reads these to decide whether another step fits in the budget.
 */
export const STEP_NEEDS_MS = { plan: 4_000, agent: 3_000, tools: 1_500, draft: 4_000, critic: 3_500 } as const

/** Rounds away floating-point noise from costs and their sums. */
export const round12 = (value: number) => Math.round(value * 1e12) / 1e12
