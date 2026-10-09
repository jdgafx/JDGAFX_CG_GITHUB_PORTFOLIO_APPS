import { withDeadline } from './deadline'
import { isDeadlineError, providerFailure, upstreamStatus } from './http'
import { TOOL_DEFINITIONS, runTool } from './tools'
import type { Recorder } from './trace'

// The one chat model for every chat call in this app. It is fixed here: it is
// never read from the environment and never taken from the browser.
export const MODEL = 'anthropic/claude-haiku-5.5'

const PROVIDER = 'The AI provider'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// A retry needs at least this much of the run's budget left to be worth sending.
const MIN_RETRY_MS = 8_000

// One round of tool calls per question, and at most this many calls in it.
const MAX_TOOL_CALLS = 3

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

// A message as OpenRouter takes it. The browser only ever supplies the first kind.
export type Turn =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost?: number
}

interface Completion {
  model?: string
  choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown }; finish_reason?: string | null }>
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

// The tool calls the model asked for, malformed entries dropped and the rest capped.
function readToolCalls(completion: Completion): ToolCall[] {
  const raw = completion.choices?.[0]?.message?.tool_calls
  if (!Array.isArray(raw)) return []
  const calls: ToolCall[] = []
  for (const item of raw) {
    const call = (typeof item === 'object' && item !== null ? item : {}) as {
      id?: unknown
      function?: { name?: unknown; arguments?: unknown }
    }
    const { name, arguments: args } = call.function ?? {}
    if (typeof call.id !== 'string' || typeof name !== 'string') continue
    calls.push({ id: call.id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : '{}' } })
  }
  return calls.slice(0, MAX_TOOL_CALLS)
}

// One request to OpenRouter. Failures come back as data, so the caller can mark
// the step before it answers the browser.
async function sendAttempt(
  apiKey: string,
  turns: Turn[],
  maxTokens: number,
  timeoutMs: number,
  toolChoice?: 'none',
): Promise<Attempt> {
  // The deadline covers the body read as well as the headers, so a reply that stalls midway ends at the limit.
  type Got =
    | { kind: 'completion'; completion: Completion }
    | { kind: 'http'; status: number; body: string }
    | { kind: 'unreadable'; error: unknown }
  let got: Got
  try {
    got = await withDeadline<Got>(timeoutMs, undefined, async signal => {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens,
          // Reasoning tokens count against max_tokens, so a reasoning route could
          // use up the budget and leave no room for the reply.
          reasoning: { enabled: false },
          // Asks OpenRouter to return token counts and cost with the reply.
          usage: { include: true },
          // The tools stay listed on the answer call, because the messages now hold
          // tool calls. 'none' is what keeps that call to one round.
          tools: TOOL_DEFINITIONS,
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          messages: turns,
        }),
      })
      if (!response.ok) return { kind: 'http', status: response.status, body: await response.text().catch(() => '<unreadable>') }
      try {
        const data: unknown = await response.json()
        if (typeof data !== 'object' || data === null) throw new TypeError('reply is not an object')
        return { kind: 'completion', completion: data as Completion }
      } catch (error) {
        if (isDeadlineError(error)) throw error
        return { kind: 'unreadable', error }
      }
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

  if (got.kind === 'http') {
    // Vendor error text can carry account or billing detail. Log it, never ship it.
    console.error(`ai: upstream ${got.status}: ${got.body}`)
    return {
      ok: false,
      httpStatus: upstreamStatus(got.status),
      message: providerFailure(PROVIDER, got.status),
      detail: `HTTP ${got.status} from the AI provider`,
    }
  }

  if (got.kind === 'unreadable') {
    console.error('ai: could not parse upstream JSON', got.error)
    return {
      ok: false,
      httpStatus: 502,
      message: `${PROVIDER} returned an unreadable response.`,
      detail: 'The provider reply was not JSON',
    }
  }
  return { ok: true, completion: got.completion }
}

type Asked =
  | { ok: true; completion: Completion; usages: Array<Usage | undefined>; attempts: number }
  | { ok: false; httpStatus: number; message: string; detail: string }

// One question to the model, with one retry when the reply has no text and asks for no
// tool. Every attempt shares the deadline, so a retry cannot push the run past the
// function's time limit.
async function askModel(
  apiKey: string,
  turns: Turn[],
  options: { maxTokens: number; deadlineAt: number },
  toolChoice?: 'none',
): Promise<Asked> {
  const usages: Array<Usage | undefined> = []
  let completion: Completion | undefined
  let attempts = 0

  while (attempts < 2) {
    const remaining = options.deadlineAt - Date.now()
    if (remaining <= 0 || (attempts > 0 && remaining < MIN_RETRY_MS)) break
    attempts += 1
    const attempt = await sendAttempt(apiKey, turns, options.maxTokens, remaining, toolChoice)
    if (!attempt.ok) return attempt
    completion = attempt.completion
    usages.push(completion.usage)
    // A tool request has no text, so it is an answer for this purpose, not an empty reply.
    if (replyText(completion) || readToolCalls(completion).length > 0) break
  }

  if (!completion) {
    return { ok: false, httpStatus: 503, message: `${PROVIDER} did not answer in time.`, detail: 'No time left in the run budget' }
  }
  return { ok: true, completion, usages, attempts }
}

function stepFor(asked: Extract<Asked, { ok: true }>, note = ''): { detail: string; tokens?: number; cost?: number } {
  const usage = sumUsage(asked.usages)
  const retried = asked.attempts > 1 ? ', retried once after an empty reply' : ''
  return {
    detail: `${asked.completion.model ?? MODEL}${note}${retried}`,
    tokens: usage?.total_tokens,
    cost: usage?.cost,
  }
}

// The model call. When the model asks for tools, they run in parallel, each timed and
// recorded as its own step, and the model is called once more to write the answer from
// their results. That second call cannot ask for more tools. The trace gets 'model call',
// then one 'tool call' per tool and 'model answer'. Without a tool request it is a
// single 'model call' step.
export async function runModelCall(
  apiKey: string,
  turns: Turn[],
  options: { maxTokens: number; deadlineAt: number },
  run: Recorder,
): Promise<ModelOutcome> {
  const first = await askModel(apiKey, turns, options)
  if (!first.ok) {
    run.add('model call', 'failed', first.detail)
    return { ok: false, httpStatus: first.httpStatus, message: first.message }
  }

  const calls = readToolCalls(first.completion)
  if (calls.length === 0) {
    const { detail, ...figures } = stepFor(first)
    run.add('model call', 'ok', detail, figures)
    return { ok: true, completion: first.completion, usage: sumUsage(first.usages) }
  }

  const { detail, ...figures } = stepFor(first, `, asked for ${[...new Set(calls.map(call => call.function.name))].join(' and ')}`)
  run.add('model call', 'ok', detail, figures)

  const results = await Promise.all(calls.map(call => runTool(call.function.name, call.function.arguments, options.deadlineAt)))
  results.forEach(result =>
    run.add('tool call', result.ok ? 'ok' : 'failed', result.detail, { ms: result.ms, call: result.call, source: result.source }),
  )

  const withResults: Turn[] = [
    ...turns,
    { role: 'assistant', content: replyText(first.completion) || null, tool_calls: calls },
    ...calls.map((call, i): Turn => ({ role: 'tool', tool_call_id: call.id, content: results[i].content })),
  ]
  const answer = await askModel(apiKey, withResults, options, 'none')
  if (!answer.ok) {
    run.add('model answer', 'failed', answer.detail)
    return { ok: false, httpStatus: answer.httpStatus, message: answer.message }
  }
  const { detail: answerDetail, ...answerFigures } = stepFor(answer)
  run.add('model answer', 'ok', answerDetail, answerFigures)
  return { ok: true, completion: answer.completion, usage: sumUsage([...first.usages, ...answer.usages]) }
}
