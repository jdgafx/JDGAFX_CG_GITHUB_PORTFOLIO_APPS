import { TOOL_DEFINITIONS, runTool } from './tools'
import type { Recorder } from './trace'
import { MODEL, streamChat, type StreamOutcome, type ToolCall, type Turn, type Usage } from './stream'

export { MODEL, type Turn, type Usage }

// A retry needs at least this much of the run's budget left to be worth sending.
const MIN_RETRY_MS = 8_000
// Per-call limits. Healthy first data arrives in about 1.2 to 2 s; a call that has said nothing
// by FIRST_BYTE_MS is one of the provider's rare hangs and is tried once more.
export const FIRST_BYTE_MS = 6_000
const IDLE_MS = 10_000

// One round of tool calls per question, and at most this many calls in it.
const MAX_TOOL_CALLS = 3

const USAGE_KEYS = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const

// Totals every attempt, because a discarded attempt still cost tokens. A field stays
// unreported if any attempt left it out, rather than being guessed.
export function sumUsage(parts: Array<Usage | undefined>): Usage | undefined {
  const total: Usage = {}
  for (const key of USAGE_KEYS) {
    const values = parts.map(part => part?.[key])
    if (values.every((value): value is number => typeof value === 'number')) {
      total[key] = values.reduce((sum, value) => sum + value, 0)
    }
  }
  return Object.keys(total).length > 0 ? total : undefined
}

export interface RunOptions {
  maxTokens: number
  deadlineAt: number
  cancel?: AbortSignal
  firstByteMs?: number
  // Text of the answer, as it arrives.
  onText: (delta: string) => void
}

export type ModelOutcome =
  | { ok: true; text: string; model?: string; usage?: Usage; finishReason?: string }
  | { ok: false; httpStatus: number; message: string }

type Okay = Extract<StreamOutcome, { ok: true }>
type Asked =
  | { ok: true; call: Okay; usages: Array<Usage | undefined>; attempts: number; firstFailure?: string }
  | { ok: false; httpStatus: number; message: string; detail: string }

// One question to the model, with one retry when nothing was heard from the provider (a hang or a
// dropped connection) or the reply was empty. A retry never follows heard text, so nothing is spoken
// twice. Every attempt shares the deadline.
async function askModel(apiKey: string, turns: Turn[], options: RunOptions, toolChoice?: 'none'): Promise<Asked> {
  const usages: Array<Usage | undefined> = []
  let attempts = 0
  let firstFailure: string | undefined
  while (attempts < 2) {
    const remaining = options.deadlineAt - Date.now()
    if (remaining <= 0 || (attempts > 0 && remaining < MIN_RETRY_MS)) break
    attempts += 1
    const outcome = await streamChat(apiKey, turns, {
      maxTokens: options.maxTokens,
      tools: TOOL_DEFINITIONS,
      toolChoice,
      cancel: options.cancel,
      deadlineAt: options.deadlineAt,
      firstByteMs: options.firstByteMs ?? FIRST_BYTE_MS,
      idleMs: IDLE_MS,
      onText: options.onText,
    })
    if (!outcome.ok) {
      if (!outcome.retryable || attempts > 1) return outcome
      firstFailure = outcome.detail.charAt(0).toLowerCase() + outcome.detail.slice(1)
      continue
    }
    usages.push(outcome.usage)
    // A tool request has no text, so it is an answer for this purpose, not an empty reply.
    if (outcome.text || outcome.toolCalls.length > 0) return { ok: true, call: outcome, usages, attempts, firstFailure }
    firstFailure = 'the reply was empty'
  }
  return { ok: false, httpStatus: 503, message: 'The AI provider did not answer in time.', detail: 'No time left in the run budget' }
}

function stepFor(asked: Extract<Asked, { ok: true }>, note = ''): { detail: string; tokens?: number; cost?: number } {
  const usage = sumUsage(asked.usages)
  const first = asked.call.firstTextMs !== undefined ? `, first words after ${Math.round(asked.call.firstTextMs).toLocaleString('en-US')} ms` : ''
  const retried = asked.attempts > 1 ? `, retried once (${asked.firstFailure ?? 'the first try failed'})` : ''
  return { detail: `${asked.call.model ?? MODEL}${note}${first}${retried}`, tokens: usage?.total_tokens, cost: usage?.cost }
}

const toolNames = (calls: ToolCall[]) => [...new Set(calls.map(call => call.function.name))].join(' and ')

// The model call. When the model asks for tools, they run in parallel, each timed and recorded as its
// own step before the answer, and the model is called once more to write the answer from their results.
// That second call cannot ask for more tools. The trace gets 'model call', then one 'tool call' per tool
// and 'model answer'. Without a tool request it is a single 'model call' step. Text of either call
// goes to onText the moment it arrives.
export async function runModelCall(apiKey: string, turns: Turn[], options: RunOptions, run: Recorder): Promise<ModelOutcome> {
  const first = await askModel(apiKey, turns, options)
  if (!first.ok) {
    run.add('model call', 'failed', first.detail)
    return { ok: false, httpStatus: first.httpStatus, message: first.message }
  }

  const calls = first.call.toolCalls.slice(0, MAX_TOOL_CALLS)
  if (calls.length === 0) {
    const { detail, ...figures } = stepFor(first)
    run.add('model call', 'ok', detail, figures)
    return { ok: true, text: first.call.text, model: first.call.model, usage: sumUsage(first.usages), finishReason: first.call.finishReason }
  }

  const { detail, ...figures } = stepFor(first, `, asked for ${toolNames(calls)}`)
  run.add('model call', 'ok', detail, figures)

  const results = await Promise.all(calls.map(call => runTool(call.function.name, call.function.arguments, options.deadlineAt, options.cancel)))
  results.forEach(result =>
    run.add('tool call', result.ok ? 'ok' : 'failed', result.detail, {
      ms: result.ms,
      call: result.call,
      source: result.source,
      reading: result.reading,
    }),
  )
  if (options.cancel?.aborted) return { ok: false, httpStatus: 499, message: 'Stopped.' }

  const withResults: Turn[] = [
    ...turns,
    { role: 'assistant', content: first.call.text || null, tool_calls: calls },
    ...calls.map((call, i): Turn => ({ role: 'tool', tool_call_id: call.id, content: results[i].content })),
  ]
  // Text that came before the tool call stays; a space keeps the answer from running into it.
  let joined = first.call.text === ''
  const answerOptions: RunOptions = {
    ...options,
    onText: delta => {
      if (!joined) {
        joined = true
        options.onText(' ')
      }
      options.onText(delta)
    },
  }
  const answer = await askModel(apiKey, withResults, answerOptions, 'none')
  if (!answer.ok) {
    run.add('model answer', 'failed', answer.detail)
    return { ok: false, httpStatus: answer.httpStatus, message: answer.message }
  }
  const { detail: answerDetail, ...answerFigures } = stepFor(answer)
  run.add('model answer', 'ok', answerDetail, answerFigures)
  const text = [first.call.text, answer.call.text].filter(Boolean).join(' ')
  return {
    ok: true,
    text,
    model: answer.call.model ?? first.call.model,
    usage: sumUsage([...first.usages, ...answer.usages]),
    finishReason: answer.call.finishReason,
  }
}
