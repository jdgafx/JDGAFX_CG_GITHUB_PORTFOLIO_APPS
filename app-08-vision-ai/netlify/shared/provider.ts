// The one chat model this app calls. It accepts images. The server owns the
// choice: clients cannot send a model, and no environment variable changes it.
export const MODEL = '~anthropic/claude-haiku-latest'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export interface Provider {
  url: string
  apiKey: string
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | {
      role: 'user'
      content: Array<{ type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string }>
    }

export function getProvider(): Provider | null {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  return { url: OPENROUTER_URL, apiKey }
}

// Every call sets max_tokens, turns reasoning off so a reasoning-capable model cannot
// spend the output budget before any visible text is written, and asks for usage
// (tokens and cost) on the response so the trace can show what the call cost. No temperature
// is sent: Haiku 5.5 rejects it, and with require_parameters that is a 404.
export function chatBody(messages: ChatMessage[], maxTokens: number): Record<string, unknown> {
  return {
    model: MODEL,
    messages,
    stream: true,
    max_tokens: maxTokens,
    reasoning: { enabled: false },
    provider: { require_parameters: true },
    usage: { include: true },
  }
}
