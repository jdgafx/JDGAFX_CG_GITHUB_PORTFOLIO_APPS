import type { Usage } from '../../src/types'
import { SHARD_MAX_TOKENS } from './budget'

/** The one chat model this app uses. It is fixed here: the client cannot choose it and no env var changes it. */
export const MODEL = '~anthropic/claude-haiku-latest'

/**
 * Output ceiling for one pass 1 shard: thinking plus the JSON. It is the number of tokens the measured model rate fits inside the
 * pass 1 time limit (budget.ts), so a reply that cannot finish in time ends at the cap, cut off and reported, and is never lost to the timeout.
 */
export const MAX_OUTPUT_TOKENS = SHARD_MAX_TOKENS

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
