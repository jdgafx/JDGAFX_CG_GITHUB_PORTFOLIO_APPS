/** The one chat model this endpoint calls. The browser cannot choose it and no env var overrides it. */
export const MODEL = '~anthropic/claude-haiku-latest'

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

export interface Provider {
  url: string
  apiKey: string
  name: 'OpenRouter'
}

/** Body for one streamed chat call. Typed so every call carries the output cap, reasoning state and usage flag. */
interface ChatRequest {
  model: typeof MODEL
  max_tokens: number
  reasoning: { enabled: false }
  usage: { include: true }
  stream: true
  messages: { role: 'user'; content: string }[]
}

/** The server-side provider, or null when the key is not set. The key is read per call and only sent to the provider. */
export function getProvider(): Provider | null {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  return { url: CHAT_URL, apiKey, name: 'OpenRouter' }
}

/**
 * Builds the body for one streamed chat call. The output cap is always explicit. Reasoning is off so a
 * reasoning-capable alias cannot spend the cap before the answer starts. Usage is requested so the run
 * metrics carry the provider's own token and cost figures.
 */
export function chatRequest(prompt: string, maxTokens: number): ChatRequest {
  return {
    model: MODEL,
    max_tokens: maxTokens,
    reasoning: { enabled: false },
    usage: { include: true },
    stream: true,
    messages: [{ role: 'user', content: prompt }],
  }
}
