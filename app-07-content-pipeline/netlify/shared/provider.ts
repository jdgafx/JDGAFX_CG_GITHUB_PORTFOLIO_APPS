import type { Usage } from './contract'
import { raceAbort } from './deadline'

// The one chat model for every text call in this app. Clients cannot pick it,
// and no environment variable overrides it.
export const MODEL = 'anthropic/claude-haiku-5.5'

export const SITE_URL = process.env.URL || 'https://jdgafx-app-07-content-pipeline.netlify.app'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'


export interface ChatReply {
  content: string
  finishReason: string | null
  servedModel: string | null
  usage: Usage | null
}

// Carries only the HTTP status. The provider's error body can name the account,
// so it is never copied into an error or sent to the browser.
export class ProviderStatusError extends Error {
  constructor(readonly status: number) {
    super(`AI provider responded with HTTP ${status}`)
  }
}

function readUsage(raw: unknown): Usage | null {
  if (!raw || typeof raw !== 'object') return null
  const { prompt_tokens, completion_tokens, total_tokens, cost } = raw as Record<string, unknown>
  if (typeof prompt_tokens !== 'number' || typeof completion_tokens !== 'number' || typeof total_tokens !== 'number') {
    return null
  }
  const usage: Usage = { prompt_tokens, completion_tokens, total_tokens }
  if (typeof cost === 'number' && Number.isFinite(cost)) usage.cost = cost
  return usage
}

// One non-streaming chat call with an explicit token ceiling. The caller owns the signal, and it
// covers the body read too: raceAbort ends the wait when the signal aborts, even if the fetch or
// its body ignores the abort.
export function chat(system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<ChatReply> {
  return raceAbort(chatOnce(system, user, maxTokens, signal), signal)
}

async function chatOnce(system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<ChatReply> {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    signal,
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY ?? ''}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': SITE_URL,
      'X-Title': 'ContentForge',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      // Reasoning stays off, so hidden tokens cannot use up the budget and cut the answer short.
      // No temperature is sent: Haiku 5.5 rejects it.
      reasoning: { enabled: false },
      // Asks OpenRouter to report the token counts and the cost of this call.
      usage: { include: true },
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new ProviderStatusError(response.status)
  }

  const parsed = await response.json() as {
    model?: unknown
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>
    usage?: unknown
  }
  const choice = parsed.choices?.[0]
  return {
    content: typeof choice?.message?.content === 'string' ? choice.message.content : '',
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    servedModel: typeof parsed.model === 'string' ? parsed.model : null,
    usage: readUsage(parsed.usage),
  }
}
