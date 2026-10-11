/** The one chat model for every planner call. The browser never chooses a model. */
export const MODEL = '~anthropic/claude-haiku-latest'

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** Sent on every JSON call, so the output can never run unbounded. Thinking counts toward it, so it holds a few hundred reasoning tokens and a full six-step plan with room to spare. */
export const MAX_TOKENS = 8192
