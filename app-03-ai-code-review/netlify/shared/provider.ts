import type { Usage } from '../../src/types'

/** The one chat model this app uses. It is fixed here: the client cannot choose it and no env var changes it. */
export const MODEL = '~anthropic/claude-haiku-latest'

/**
 * Output ceiling for the review call. Thinking is on, and its tokens count toward the cap, so it is the old 4,096 for the JSON
 * plus 1,904 for thinking (Haiku spends a few hundred to about 500 on these tasks), so a complete JSON reply still has room to finish.
 */
export const MAX_OUTPUT_TOKENS = 6000

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

export interface ProviderReply {
  model?: string
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>
  /** The summed fields plus the breakdown OpenRouter reports for thinking. */
  usage?: Usage & { completion_tokens_details?: { reasoning_tokens?: number } }
}

/**
 * Request body for one JSON review. No reasoning override is sent: the model thinks as it does by default, and the cap is
 * raised to leave room for that. usage.include asks OpenRouter to report token counts (reasoning tokens among them) and cost
 * in the reply.
 */
export function chatBody(system: string, user: string, maxTokens = MAX_OUTPUT_TOKENS): string {
  return JSON.stringify({
    model: MODEL,
    max_tokens: maxTokens,
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

/**
 * How a reply ended. Only finish_reason "stop" is a reply that ended: "length" (or "max_tokens") ran out of room for thinking
 * plus the answer, and anything else (nothing at all, a content filter, a tool call, an error) is a reply that was not finished.
 * Neither is read, however much of it parses.
 */
export type Ending = 'complete' | 'length' | 'unfinished'

export function replyEnding(reply: ProviderReply): Ending {
  const reason = reply.choices?.[0]?.finish_reason
  if (reason === 'stop') return 'complete'
  return reason === 'length' || reason === 'max_tokens' ? 'length' : 'unfinished'
}
