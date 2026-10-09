/** The one chat model this endpoint calls, pinned to Haiku 5.5 on OpenRouter. The browser cannot choose it and no env var overrides it. Haiku 5.5 rejects `temperature`, so none is ever sent. */
export const MODEL = 'anthropic/claude-haiku-5.5'

export const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Builds the body for one streamed chat call. The output cap is always explicit. Reasoning is off so a
 * reasoning-capable alias cannot spend the cap before the answer starts. Usage is requested so the run
 * metrics carry the provider's own token and cost figures.
 */
export function chatRequest(prompt: string, maxTokens: number) {
  return {
    model: MODEL,
    max_tokens: maxTokens,
    reasoning: { enabled: false },
    usage: { include: true },
    stream: true,
    messages: [{ role: 'user', content: prompt }],
  } as const
}
