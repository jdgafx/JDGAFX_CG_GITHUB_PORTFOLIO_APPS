/** The one chat model every stage calls. Client-supplied model fields are ignored. */
export const MODEL = '~anthropic/claude-haiku-latest'

const APP_TITLE = 'AgentFlow'
export const DEFAULT_SITE_URL = 'https://jdgafx-app-01-multi-agent-orchestrator.netlify.app'
const SITE_URL = process.env.URL || DEFAULT_SITE_URL

export interface Provider {
  url: string
  apiKey: string
}

/** OpenRouter is the only provider. Its key is the server-side OPENROUTER_API_KEY. */
export function getProvider(): Provider | null {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  return { url: process.env.OPENROUTER_URL ?? 'https://openrouter.ai/api/v1/chat/completions', apiKey }
}

interface ChatBody {
  model: string
  max_tokens: number
  stream: true
  stream_options: { include_usage: true }
  usage: { include: true }
  reasoning: { enabled: false }
  provider: { require_parameters: true }
  messages: Array<{ role: 'system' | 'user'; content: string }>
}

/**
 * The chat request for one stage. Every call carries an explicit `max_tokens` ceiling and
 * asks for usage, including cost, in the stream. Reasoning stays off because reasoning
 * tokens are billed against `max_tokens`.
 */
export function buildChatBody(systemPrompt: string, userMessage: string, maxTokens: number): ChatBody {
  return {
    model: MODEL,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
    usage: { include: true },
    reasoning: { enabled: false },
    provider: { require_parameters: true },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  }
}

export function requestHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': SITE_URL,
    'X-Title': APP_TITLE,
  }
}
