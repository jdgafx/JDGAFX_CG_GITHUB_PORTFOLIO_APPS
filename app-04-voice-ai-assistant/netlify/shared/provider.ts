import { isDeadlineError, providerFailure, upstreamStatus } from './http'
import type { Recorder } from './trace'

// The one chat model for every chat call in this app. It is fixed here: it is
// never read from the environment and never taken from the browser.
export const MODEL = '~anthropic/claude-haiku-latest'

const PROVIDER = 'The AI provider'
const OPENROUTER_URL = process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions'

// A retry needs at least this much of the run's budget left to be worth sending.
const MIN_RETRY_MS = 8_000

export interface Turn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost?: number
}

interface Completion {
  model?: string
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string | null }>
  usage?: Usage
}

type ModelOutcome =
  | { ok: true; completion: Completion; usage?: Usage }
  | { ok: false; httpStatus: number; message: string }

type Attempt =
  | { ok: true; completion: Completion }
  | { ok: false; httpStatus: number; message: string; detail: string }

const USAGE_KEYS = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const

// Totals every attempt, because a discarded empty reply still cost tokens. A
// field stays unreported if any attempt left it out, rather than being guessed.
function sumUsage(parts: Array<Usage | undefined>): Usage | undefined {
  const total: Usage = {}
  for (const key of USAGE_KEYS) {
    const values = parts.map(part => part?.[key])
    if (values.every((value): value is number => typeof value === 'number')) {
      total[key] = values.reduce((sum, value) => sum + value, 0)
    }
  }
  return Object.keys(total).length > 0 ? total : undefined
}

export function replyText(completion: Completion): string {
  const content = completion.choices?.[0]?.message?.content
  return typeof content === 'string' ? content.trim() : ''
}

// One request to OpenRouter. Failures come back as data, so the caller can mark
// the step before it answers the browser.
async function sendAttempt(apiKey: string, turns: Turn[], maxTokens: number, timeoutMs: number): Promise<Attempt> {
  let response: Response
  try {
    response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        // Reasoning tokens count against max_tokens, so a reasoning route could
        // use up the budget and leave no room for the reply.
        reasoning: { enabled: false },
        // Asks OpenRouter to return token counts and cost with the reply.
        usage: { include: true },
        messages: turns,
      }),
    })
  } catch (err) {
    console.error('ai: upstream request failed', err)
    if (isDeadlineError(err)) {
      return { ok: false, httpStatus: 503, message: `${PROVIDER} did not answer in time.`, detail: 'No reply before the time limit' }
    }
    return {
      ok: false,
      httpStatus: 503,
      message: `${PROVIDER} could not be reached. Try again in a moment.`,
      detail: 'The request did not reach the AI provider',
    }
  }

  if (!response.ok) {
    // Vendor error text can carry account or billing detail. Log it, never ship it.
    const body = await response.text().catch(() => '<unreadable>')
    console.error(`ai: upstream ${response.status}: ${body}`)
    return {
      ok: false,
      httpStatus: upstreamStatus(response.status),
      message: providerFailure(PROVIDER, response.status),
      detail: `HTTP ${response.status} from the AI provider`,
    }
  }

  try {
    const data: unknown = await response.json()
    if (typeof data !== 'object' || data === null) throw new TypeError('reply is not an object')
    return { ok: true, completion: data as Completion }
  } catch (err) {
    console.error('ai: could not parse upstream JSON', err)
    return {
      ok: false,
      httpStatus: 502,
      message: `${PROVIDER} returned an unreadable response.`,
      detail: 'The provider reply was not JSON',
    }
  }
}

// One model call, with one retry when the reply has no text. Both attempts share
// the deadline, so a retry cannot push the run past the function's time limit.
// The trace gets a single 'model call' step that covers them.
export async function runModelCall(
  apiKey: string,
  turns: Turn[],
  options: { maxTokens: number; deadlineAt: number },
  run: Recorder,
): Promise<ModelOutcome> {
  const usages: Array<Usage | undefined> = []
  let completion: Completion | undefined
  let attempts = 0

  while (attempts < 2) {
    const remaining = options.deadlineAt - Date.now()
    if (remaining <= 0 || (attempts > 0 && remaining < MIN_RETRY_MS)) break
    attempts += 1
    const attempt = await sendAttempt(apiKey, turns, options.maxTokens, remaining)
    if (!attempt.ok) {
      run.add('model call', 'failed', attempt.detail)
      return { ok: false, httpStatus: attempt.httpStatus, message: attempt.message }
    }
    completion = attempt.completion
    usages.push(completion.usage)
    if (replyText(completion)) break
  }

  if (!completion) {
    run.add('model call', 'failed', 'No time left in the run budget')
    return { ok: false, httpStatus: 503, message: `${PROVIDER} did not answer in time.` }
  }

  const usage = sumUsage(usages)
  const retried = attempts > 1 ? ', retried once after an empty reply' : ''
  run.add('model call', 'ok', `${completion.model ?? MODEL}${retried}`, {
    tokens: usage?.total_tokens,
    cost: usage?.cost,
  })
  return { ok: true, completion, usage }
}
