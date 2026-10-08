/** The one chat model this app uses. It is fixed here: the client cannot choose it and no env var changes it. */
const MODEL = '~anthropic/claude-haiku-latest'

/** Output ceiling for every review call, so a complete JSON reply has room to finish. */
export const MAX_OUTPUT_TOKENS = 4096

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

export interface ProviderCall {
  url: string
  apiKey: string
}

export interface ProviderUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost?: number
}

export interface ProviderReply {
  model?: string
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>
  usage?: ProviderUsage
}

/** The OpenRouter endpoint and key, or null when no key is configured. */
export function providerCall(): ProviderCall | null {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  return { url: OPENROUTER_CHAT_URL, apiKey }
}

/**
 * Request body for one JSON review. Reasoning is off, so a reasoning model
 * cannot spend the output budget before the JSON is written. usage.include asks
 * OpenRouter to report token counts and cost in the reply.
 */
export function chatBody(system: string, user: string): string {
  return JSON.stringify({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    reasoning: { enabled: false },
    usage: { include: true },
    provider: { require_parameters: true },
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })
}

export function replyText(reply: ProviderReply): string {
  return reply.choices?.[0]?.message?.content?.trim() ?? ''
}

export function replyCutShort(reply: ProviderReply): boolean {
  const reason = reply.choices?.[0]?.finish_reason
  return reason === 'length' || reason === 'max_tokens'
}
