/** The one chat model for every planner call. The browser never chooses a model. */
export const MODEL = '~anthropic/claude-haiku-latest'

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** Sent on every JSON call, so the output can never run unbounded. */
export const MAX_TOKENS = 4096

export interface ProviderConfig {
  url: string
  apiKey: string
  model: string
}

/**
 * OpenRouter settings from the Netlify environment. The key goes only into the Authorization
 * header. It is never returned to the browser or written to a log.
 */
export function getProvider(): ProviderConfig | null {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  return apiKey ? { url: OPENROUTER_URL, apiKey, model: MODEL } : null
}
