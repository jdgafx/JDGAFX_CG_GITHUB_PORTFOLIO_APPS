/** The one chat model this endpoint calls. The browser cannot choose it and no env var overrides it. */
export const MODEL = '~anthropic/claude-haiku-latest'

export interface Provider {
  url: string
  apiKey: string
  name: 'OpenRouter'
}

export function getProvider(): Provider | null {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  return {
    url: process.env.OPENROUTER_URL ?? 'https://openrouter.ai/api/v1/chat/completions',
    apiKey,
    name: 'OpenRouter',
  }
}

/**
 * Body for one streamed chat call. The output cap is always explicit. Reasoning is off so a
 * reasoning-capable alias cannot spend the cap before the answer starts. Usage is requested so
 * the run metrics carry the provider's own token and cost figures.
 */
export function chatRequest(prompt: string, maxTokens: number): Record<string, unknown> {
  return {
    model: MODEL,
    max_tokens: maxTokens,
    reasoning: { enabled: false },
    usage: { include: true },
    stream: true,
    messages: [{ role: 'user', content: prompt }],
  }
}
