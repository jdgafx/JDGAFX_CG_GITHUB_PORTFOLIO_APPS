import { newestModel, servedCheck, worstCheck, type ModelCheck } from './newest-model'
import { callModel, estimateCost, MODEL, TIMEOUT_MESSAGE, type AttemptOk, type ChatMessage } from './provider'

/** 'passage' or 'passages', by count. */
function noun(count: number): string {
  return count === 1 ? 'passage' : 'passages'
}

export interface AnswerInput {
  question: string
  /** Passages as the browser labelled them. Each starts with "[Chunk N]:". */
  chunks: string[]
  /** The N from each passage label, in the same order as `chunks`. Only these can be cited. */
  chunkIndices: number[]
  documentTitle: string
}

interface AiResponse {
  answer: string
  source_chunk_indices: number[]
  /** The model's own rating of its answer, 0 to 1. It is not checked against the passages. */
  confidence: number
}

export interface TraceStep {
  name: string
  status: 'ok' | 'failed' | 'skipped'
  ms: number
  detail: string
  tokens?: number | null
  cost?: number | null
}

interface Usage {
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  cost: number | null
  /** 'reported' came from the provider; 'estimated' was computed from catalogue pricing. */
  cost_source: 'reported' | 'estimated' | null
}

export interface RunPayload {
  result: AiResponse
  trace: TraceStep[]
  usage: Usage
  /** The model that wrote the shown answer, as the provider named it. Null when the reply named none. */
  servedModel: string | null
  newestModel: string | null
  /** The worst check across every model call in the run. */
  modelCheck: ModelCheck
  /** The served id of a call that did not match the newest model, or null when none did. */
  mismatchedModel: string | null
  totalMs: number
}

export type RunOutcome =
  | ({ ok: true } & RunPayload)
  | { ok: false; status: number; error: string; trace: TraceStep[]; totalMs: number }

/** Told when each step starts and when it finishes, so the browser can show progress. */
interface RunEvents {
  start: (name: string) => void
  step: (step: TraceStep) => void
}

// Netlify ends a synchronous call after about 30 seconds. One deadline covers the
// first call, the retry and the price lookup, so a retry cannot double the wait.
const UPSTREAM_TIMEOUT_MS = 25_000
// A retry is started only when at least this much of the deadline is left.
const RETRY_MIN_MS = 5_000
// One model call may take this long, about 1.5 times a healthy answer with thinking on (about 7 to 11 seconds:
// the 4 to 8 seconds of the answer plus a few hundred reasoning tokens), so a stalled call leaves room for the
// one retry inside the 25 s deadline (14 s + a retry with the 11 s left, under the 30 s cut-off).
const CALL_LIMIT_MS = 14_000

// The browser repeats these names for steps it skips when no passage matches,
// so keep the two lists in step.
const STEP_ACCEPT = 'Accept request'
const STEP_BUILD = 'Build prompt'
const STEP_CALL = 'Call model'
const STEP_RETRY = 'Retry model call'
const STEP_PARSE = 'Parse and validate'

const EMPTY_REPLY = 'The model returned an empty response. Please try again.'
const CUT_OFF_REPLY = 'The AI reply was cut off before the answer finished. Try a narrower question.'

const SYSTEM_PROMPT = `You are DocMind, an intelligent document Q&A assistant. You answer questions based ONLY on the provided document chunks.

Rules:
- Answer using ONLY information explicitly found in the provided chunks
- If the chunks don't contain enough information to answer, clearly say so
- Never fabricate or infer information beyond what is in the chunks
- Be precise and clear. Write as an informed reader would: never say "the chunks" or "the provided text" in the answer (if you must name them, call them passages); the [Chunk N] markers are the only reference to them
- Cite as you write: put the label of the chunk that supports a claim right after it, like [Chunk 4], or [Chunk 4, Chunk 9] when two support it. Cite only chunks you used. Put the marker after the sentence's last word, before its full stop
- If the chunks do not contain the answer, say plainly that the passages provided do not state it (never claim the document as a whole does not say it, because only some passages were provided), and return an empty source_chunk_indices list

Confidence scoring:
- 0.8-1.0: The chunks directly and clearly answer the question
- 0.5-0.79: Partial or indirect answer found in chunks
- 0.0-0.49: Limited or no relevant information in the provided chunks

You MUST respond with ONLY a valid JSON object in this exact format (no markdown, no extra text):
{"answer":"The station opened in 1987 [Chunk 2]. It handles freight [Chunk 0, Chunk 5].","source_chunk_indices":[0,2,5],"confidence":0.85}

The source_chunk_indices must reference the exact [Chunk N] numbers from the provided text (0-based index N).`

function buildUserMessage(question: string, chunks: string[], documentTitle: string): string {
  return `Document: "${documentTitle}"

Document Chunks:
${chunks.join('\n\n')}

Question: ${question}

Respond with ONLY the JSON object.`
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1]
    if (inner !== undefined) return inner.trim()
  }
  const jsonStart = trimmed.indexOf('{')
  const jsonEnd = trimmed.lastIndexOf('}')
  if (jsonStart !== -1 && jsonEnd !== -1) {
    return trimmed.slice(jsonStart, jsonEnd + 1)
  }
  return trimmed
}

type ParsedAnswer = { ok: true; result: AiResponse } | { ok: false; message: string }

/**
 * Reads the model's JSON reply. A citation is kept only when it names a passage that
 * was sent (`sentIndices`). Each kept citation appears once, in the model's order.
 * The confidence is clamped to 0 to 1.
 */
export function parseAnswer(content: string, sentIndices: readonly number[]): ParsedAnswer {
  if (content.trim() === '') return { ok: false, message: EMPTY_REPLY }
  let raw: unknown
  try {
    raw = JSON.parse(extractJson(content))
  } catch {
    return { ok: false, message: 'The model returned a malformed response. Please try again.' }
  }
  const fields = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const { answer, source_chunk_indices: indices, confidence } = fields
  if (typeof answer !== 'string' || !Array.isArray(indices) || typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    return { ok: false, message: 'The model returned an invalid response structure. Please try again.' }
  }
  if (answer.trim() === '') return { ok: false, message: EMPTY_REPLY }

  const sent = new Set(sentIndices)
  const cited = [...new Set(indices.filter((i): i is number => typeof i === 'number' && sent.has(i)))]
  return {
    ok: true,
    result: { answer, source_chunk_indices: cited, confidence: Math.min(1, Math.max(0, confidence)) },
  }
}

/** A reply can be used when it has text and was not cut off at the output cap. */
function usable(attempt: AttemptOk): boolean {
  return attempt.content.trim() !== '' && attempt.finishReason !== 'length'
}

function sumOrNull(values: Array<number | null>): number | null {
  if (values.some(v => v === null)) return null
  return values.reduce<number>((total, v) => total + (v ?? 0), 0)
}

/** One call's cost at the list price of the model that served it. Null when the call named no model or has no token counts. */
function estimateCallCost(reply: AttemptOk, deadline: number): Promise<number | null> {
  const { model, usage } = reply
  if (model === null || usage.prompt_tokens === null || usage.completion_tokens === null) return Promise.resolve(null)
  return estimateCost(model, usage.prompt_tokens, usage.completion_tokens, deadline)
}

/**
 * Totals across every attempt, since each attempt was billed. A reported cost is used as it is. Otherwise each call is
 * priced at its own served model, and the estimate is null when any call cannot be priced.
 */
async function buildUsage(replies: AttemptOk[], deadline: number): Promise<Usage> {
  const usages = replies.map(reply => reply.usage)
  const prompt = sumOrNull(usages.map(u => u.prompt_tokens))
  const completion = sumOrNull(usages.map(u => u.completion_tokens))
  const total = sumOrNull(usages.map(u => u.total_tokens))
  const reported = sumOrNull(usages.map(u => u.cost))
  if (reported !== null) {
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total, cost: reported, cost_source: 'reported' }
  }
  const estimates: Array<number | null> = []
  for (const reply of replies) estimates.push(await estimateCallCost(reply, deadline))
  const estimated = sumOrNull(estimates)
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    cost: estimated,
    cost_source: estimated === null ? null : 'estimated',
  }
}

function servedBy(attempt: AttemptOk): string {
  return `Response from ${attempt.model ?? 'a model the provider did not name'}.`
}

function costOf(attempt: AttemptOk): Pick<TraceStep, 'tokens' | 'cost'> {
  return { tokens: attempt.usage.total_tokens, cost: attempt.usage.cost }
}

/**
 * Runs the answer pipeline and records every step with a server-side timer.
 * `started` is the request's start time, so the first step includes the checks
 * made before this function was called. `signal` cancels the model calls when the
 * browser has gone away.
 */
export async function runAnswer(
  input: AnswerInput,
  apiKey: string,
  started: number,
  events: RunEvents,
  signal: AbortSignal,
): Promise<RunOutcome> {
  const trace: TraceStep[] = []
  const record = (name: string, begun: number, status: TraceStep['status'], detail: string, extra: Pick<TraceStep, 'tokens' | 'cost'> = {}) => {
    const step: TraceStep = { name, status, ms: Date.now() - begun, detail, ...extra }
    trace.push(step)
    events.step(step)
  }
  const fail = (status: number, error: string, skipped: string[]): RunOutcome => {
    for (const name of skipped) record(name, Date.now(), 'skipped', 'Not run because an earlier step failed.')
    return { ok: false, status, error, trace, totalMs: Date.now() - started }
  }

  events.start(STEP_ACCEPT)
  record(STEP_ACCEPT, started, 'ok', `Question and ${input.chunks.length} ${noun(input.chunks.length)} checked.`)

  events.start(STEP_BUILD)
  const built = Date.now()
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(input.question, input.chunks, input.documentTitle) },
  ]
  const characters = messages.reduce((total, m) => total + m.content.length, 0)
  record(STEP_BUILD, built, 'ok', `System prompt and ${input.chunks.length} ${noun(input.chunks.length)}, ${characters} characters in total.`)

  const deadline = started + UPSTREAM_TIMEOUT_MS
  const callLimit = () => Math.min(deadline, Date.now() + CALL_LIMIT_MS)
  // One list read per run, started before the first call. It never rejects and is awaited only after the answer.
  const newestP = newestModel()
  events.start(STEP_CALL)
  const called = Date.now()
  const first = await callModel(apiKey, messages, callLimit(), signal)

  // Every call that returned a reply, so each one's served model is checked and priced.
  const replies: AttemptOk[] = []
  let attempt: AttemptOk | null = null
  // Why a second call is made, or null when the first one is used as it is.
  let reason: string | null = null
  if (first.ok) {
    replies.push(first)
    if (usable(first)) {
      attempt = first
      record(STEP_CALL, called, 'ok', servedBy(first), costOf(first))
    } else if (deadline - Date.now() < RETRY_MIN_MS) {
      record(STEP_CALL, called, 'failed', 'Output was empty or cut off, and there was no time to ask again.', costOf(first))
      return fail(504, TIMEOUT_MESSAGE, [STEP_PARSE])
    } else {
      reason = 'the first reply was empty or cut off'
      record(STEP_CALL, called, 'failed', 'Output was empty or cut off. Asking the model again.', costOf(first))
    }
  } else if (first.retryable && deadline - Date.now() >= RETRY_MIN_MS) {
    reason = 'the first call timed out or did not connect'
    record(STEP_CALL, called, 'failed', `${first.message} Asking the model once more.`)
  } else {
    record(STEP_CALL, called, 'failed', first.message)
    return fail(first.status, first.message, [STEP_PARSE])
  }

  if (reason !== null) {
    events.start(STEP_RETRY)
    const retried = Date.now()
    const second = await callModel(apiKey, messages, callLimit(), signal)
    if (!second.ok) {
      record(STEP_RETRY, retried, 'failed', second.message)
      return fail(second.status, second.message, [STEP_PARSE])
    }
    replies.push(second)
    // The last attempt gets the same check as the first: a reply stopped at the token cap is never parsed, even when its JSON closes.
    if (second.finishReason === 'length') {
      record(STEP_RETRY, retried, 'failed', 'The retried reply was cut off at the output limit.', costOf(second))
      return fail(502, CUT_OFF_REPLY, [STEP_PARSE])
    }
    attempt = second
    record(STEP_RETRY, retried, 'ok', `Retried once because ${reason}. ${servedBy(second)}`, costOf(second))
  }
  if (attempt === null) return fail(502, EMPTY_REPLY, [STEP_PARSE])

  events.start(STEP_PARSE)
  const parsing = Date.now()
  const parsed = parseAnswer(attempt.content, input.chunkIndices)
  if (!parsed.ok) {
    record(STEP_PARSE, parsing, 'failed', parsed.message)
    return fail(502, parsed.message, [])
  }
  // Only the call that wrote the shown answer names its model. Another call's model is never used in its place.
  const servedModel = attempt.model
  const usage = await buildUsage(replies, deadline)
  const newest = await newestP
  const checks = replies.map(reply => ({ served: reply.model, check: servedCheck(newest, reply.model) }))
  for (const { served, check } of checks) {
    if (check === 'mismatch') console.warn(`model mismatch: served ${served}, newest ${newest}, requested ${MODEL}`)
  }
  const modelCheck = worstCheck(checks.map(c => c.check))
  const mismatchedModel = checks.find(c => c.check === 'mismatch')?.served ?? null
  const cited = parsed.result.source_chunk_indices.length
  const confidence = Math.round(parsed.result.confidence * 100)
  const estimateNote = usage.cost_source === 'estimated' ? ' Cost estimated from catalogue pricing.' : ''
  record(STEP_PARSE, parsing, 'ok', `Answer cites ${cited} ${noun(cited)}. Self-rated ${confidence}%.${estimateNote}`)

  return { ok: true, result: parsed.result, trace, usage, servedModel, newestModel: newest, modelCheck, mismatchedModel, totalMs: Date.now() - started }
}
