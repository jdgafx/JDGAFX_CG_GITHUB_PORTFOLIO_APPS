import { TOOL_DEFINITIONS, runTool } from './tools'
import type { ModelRecord, Recorder } from './trace'
import { MODEL, streamChat, type StreamOutcome, type ToolCall, type Turn, type Usage } from './stream'
import { newestModel, servedCheck, type ServedCheck } from './newest-model'

export { MODEL, type Turn, type Usage }

// A retry needs at least this much of the run's budget left to be worth sending.
const MIN_RETRY_MS = 8_000
// Per-call limits. Healthy first data arrives in about 1.2 to 2 s, plus up to about 3 s when the
// provider holds its stream while Haiku thinks (about 500 tokens); a call that has said nothing
// by FIRST_BYTE_MS is one of the provider's rare hangs and is tried once more. A hang at 9 s
// still leaves 16 s of the 25 s run budget, above MIN_RETRY_MS.
export const FIRST_BYTE_MS = 9_000
const IDLE_MS = 10_000

// One round of tool calls per question, and at most this many calls in it.
const MAX_TOOL_CALLS = 3

const USAGE_KEYS = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const

// Totals every call, because a discarded or failed call still cost tokens. A call with no usage block is
// counted in `unreportedCalls`, never guessed, so a total with that count is "at least" what it shows.
// A figure stays unreported if a call that did report usage left it out.
export function sumUsage(parts: Array<Usage | undefined>): Usage | undefined {
  const known = parts.filter((part): part is Usage => part !== undefined)
  const total: Usage = {}
  if (known.length > 0) {
    for (const key of USAGE_KEYS) {
      const values = known.map(part => part[key])
      if (values.every((value): value is number => typeof value === 'number')) {
        total[key] = values.reduce((sum, value) => sum + value, 0)
      }
    }
  }
  const unreported = parts.length - known.length
  if (unreported > 0) total.unreportedCalls = unreported
  return Object.keys(total).length > 0 ? total : undefined
}

// The figures a trace row carries for the calls behind it. `notReported` marks a row with a call that gave none.
function figuresOf(usages: Array<Usage | undefined>): { tokens?: number; cost?: number; notReported?: true } {
  const usage = sumUsage(usages)
  return { tokens: usage?.total_tokens, cost: usage?.cost, ...(usage?.unreportedCalls ? { notReported: true as const } : {}) }
}

export interface RunOptions {
  maxTokens: number
  deadlineAt: number
  cancel?: AbortSignal
  firstByteMs?: number
  // Text of the answer, as it arrives.
  onText: (delta: string) => void
}

/** The run's record: the reply-producing call's served model, with the worst check across all the run's model calls. */
export interface RunModel extends ModelRecord {
  /** The served model of the call behind `modelCheck`. A mismatch names it in the title. */
  checkedModel: string | null
}

export type ModelOutcome =
  | { ok: true; text: string; usage?: Usage; finishReason?: string; record: RunModel }
  // `usage` is what every call made so far was billed, also when the run failed.
  | { ok: false; httpStatus: number; message: string; usage?: Usage }

type Okay = Extract<StreamOutcome, { ok: true }>
type CutOff = { message: string; detail: string }

// A reply that stopped at the token cap (thinking plus the answer used max_tokens), or whose stream ended
// with no finish reason at all, is cut off: its text may be a half sentence and its tool arguments half
// a JSON object. It is never used as a finished reply.
function cutOff(call: Okay): CutOff | null {
  if (call.finishReason === 'length') {
    return { message: 'The AI ran out of reply length before it finished the answer. Try a shorter question.', detail: 'Cut off at the length limit' }
  }
  if (call.finishReason === undefined) {
    return { message: 'The AI reply stopped before it was finished. Try again.', detail: 'The stream ended with no finish reason' }
  }
  return null
}

type Asked =
  | { ok: true; call: Okay; usages: Array<Usage | undefined>; attempts: number; firstFailure?: string }
  | { ok: false; httpStatus: number; message: string; detail: string; usages: Array<Usage | undefined> }

// One question to the model, with one retry when nothing was heard from the provider (a hang or a
// dropped connection) or the reply was empty. A retry never follows heard text, so nothing is spoken
// twice. Every attempt shares the deadline.
async function askModel(apiKey: string, turns: Turn[], options: RunOptions, toolChoice?: 'none'): Promise<Asked> {
  const usages: Array<Usage | undefined> = []
  let attempts = 0
  let firstFailure: string | undefined
  let lastCut: CutOff | null = null
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
    // Every attempt is counted, failed or not; a call that reported no usage stays undefined and is counted as such.
    // A request the provider refused outright was never billed, so it is not a call at all.
    if (!(!outcome.ok && outcome.unbilled)) usages.push(outcome.usage)
    if (!outcome.ok) {
      if (!outcome.retryable || attempts > 1) return { ok: false, httpStatus: outcome.httpStatus, message: outcome.message, detail: outcome.detail, usages }
      firstFailure = outcome.detail.charAt(0).toLowerCase() + outcome.detail.slice(1)
      continue
    }
    lastCut = cutOff(outcome)
    if (lastCut) {
      // Only a reply with nothing in it is asked for again, as for any empty reply. Heard text is never repeated.
      if (outcome.text || outcome.toolCalls.length > 0) return { ok: false, httpStatus: 502, message: lastCut.message, detail: lastCut.detail, usages }
      firstFailure = 'the reply was empty and cut off'
      continue
    }
    // A tool request has no text, so it is an answer for this purpose, not an empty reply.
    if (outcome.text || outcome.toolCalls.length > 0) return { ok: true, call: outcome, usages, attempts, firstFailure }
    firstFailure = 'the reply was empty'
  }
  if (lastCut) return { ok: false, httpStatus: 502, message: lastCut.message, detail: lastCut.detail, usages }
  return { ok: false, httpStatus: 503, message: 'The AI provider did not answer in time.', detail: 'No time left in the run budget', usages }
}

function stepFor(asked: Extract<Asked, { ok: true }>, record: ModelRecord, note = ''): { detail: string; tokens?: number; cost?: number; notReported?: true } & ModelRecord {
  const first = asked.call.firstTextMs !== undefined ? `, first words after ${Math.round(asked.call.firstTextMs).toLocaleString('en-US')} ms` : ''
  const retried = asked.attempts > 1 ? `, retried once (${asked.firstFailure ?? 'the first try failed'})` : ''
  return { detail: `${record.servedModel ?? 'not reported'}${note}${first}${retried}`, ...figuresOf(asked.usages), ...record }
}

// What one model call says about itself, checked against the newest model. A mismatch is logged and shown, never refused.
function recordFor(served: string | undefined, newest: string | null): ModelRecord {
  const servedModel = served ?? null
  const modelCheck = servedCheck(newest, servedModel)
  if (modelCheck === 'mismatch') console.warn(`model mismatch: served ${servedModel}, newest ${newest}, requested ${MODEL}`)
  return { servedModel, newestModel: newest, modelCheck }
}

// How bad each check is for a run: a mismatch outranks a call that named no model, which outranks an unchecked one.
const SEVERITY: Record<ServedCheck, number> = { match: 0, unchecked: 1, 'not-reported': 2, mismatch: 3 }

// The run's record. Its served model is the reply-producing call's; its check is the worst across every call of the run.
function runRecord(reply: ModelRecord, calls: ModelRecord[]): RunModel {
  const worst = calls.reduce((a, b) => (SEVERITY[b.modelCheck] > SEVERITY[a.modelCheck] ? b : a))
  return { servedModel: reply.servedModel, newestModel: reply.newestModel, modelCheck: worst.modelCheck, checkedModel: worst.servedModel }
}

const toolNames = (calls: ToolCall[]) => [...new Set(calls.map(call => call.function.name))].join(' and ')

// The model call. When the model asks for tools, they run in parallel, each timed and recorded as its
// own step before the answer, and the model is called once more to write the answer from their results.
// That second call cannot ask for more tools. The trace gets 'model call', then one 'tool call' per tool
// and 'model answer'. Without a tool request it is a single 'model call' step. The answer's text goes
// to onText the moment it arrives. The first call's text is held until the call ends: it is passed on
// only when the model asked for no tool, because text written before a tool request is narration
// ("I'll check both cities") that the card and the voice would otherwise show and speak.
export async function runModelCall(apiKey: string, turns: Turn[], options: RunOptions, run: Recorder): Promise<ModelOutcome> {
  // The newest model is looked up while the model works, so the list adds to the run only when it is slower than the call.
  const newestP = newestModel()
  const heard: string[] = []
  const first = await askModel(apiKey, turns, { ...options, onText: delta => heard.push(delta) })
  if (!first.ok) {
    run.add('model call', 'failed', first.detail, figuresOf(first.usages))
    return { ok: false, httpStatus: first.httpStatus, message: first.message, usage: sumUsage(first.usages) }
  }
  const newest = await newestP
  const firstRecord = recordFor(first.call.model, newest)

  const calls = first.call.toolCalls.slice(0, MAX_TOOL_CALLS)
  if (calls.length === 0) {
    heard.forEach(options.onText)
    const { detail, ...figures } = stepFor(first, firstRecord)
    run.add('model call', 'ok', detail, figures)
    return { ok: true, text: first.call.text, usage: sumUsage(first.usages), finishReason: first.call.finishReason, record: runRecord(firstRecord, [firstRecord]) }
  }

  const { detail, ...figures } = stepFor(first, firstRecord, `, asked for ${toolNames(calls)}`)
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
  if (options.cancel?.aborted) return { ok: false, httpStatus: 499, message: 'Stopped.', usage: sumUsage(first.usages) }

  const withResults: Turn[] = [
    ...turns,
    { role: 'assistant', content: first.call.text || null, tool_calls: calls },
    ...calls.map((call, i): Turn => ({ role: 'tool', tool_call_id: call.id, content: results[i].content })),
  ]
  const answer = await askModel(apiKey, withResults, options, 'none')
  if (!answer.ok) {
    run.add('model answer', 'failed', answer.detail, figuresOf(answer.usages))
    return { ok: false, httpStatus: answer.httpStatus, message: answer.message, usage: sumUsage([...first.usages, ...answer.usages]) }
  }
  const answerRecord = recordFor(answer.call.model, newest)
  const { detail: answerDetail, ...answerFigures } = stepFor(answer, answerRecord)
  run.add('model answer', 'ok', answerDetail, answerFigures)
  // The reply is the final answer call's text. Any text written before the tool call is dropped, here and in the stream.
  const text = answer.call.text
  return {
    ok: true,
    text,
    usage: sumUsage([...first.usages, ...answer.usages]),
    finishReason: answer.call.finishReason,
    // The run is recorded as the model that wrote the final reply, so an answer that names no model reads "not reported".
    record: runRecord(answerRecord, [firstRecord, answerRecord]),
  }
}
