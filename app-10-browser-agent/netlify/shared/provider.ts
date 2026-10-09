/** The one chat model for every planner call. The browser never chooses a model. */
export const MODEL = 'anthropic/claude-haiku-5.5'

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** Sent on every JSON call, so the output can never run unbounded. */
export const MAX_TOKENS = 4096
