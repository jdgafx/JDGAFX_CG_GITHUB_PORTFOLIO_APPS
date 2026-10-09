import { callModel, estimateCost, TIMEOUT_MESSAGE, type AttemptOk, type ChatMessage, type RawUsage } from './provider'

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
  model: string | null
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
// One model call may take this long, about 1.5 times a healthy answer (4 to 8 seconds), so a stalled call leaves
// room for the one retry inside the deadline.
const CALL_LIMIT_MS = 12_000

// The browser repeats these names for steps it skips when no passage matches,
// so keep the two lists in step.
const STEP_ACCEPT = 'Accept request'
const STEP_BUILD = 'Build prompt'
const STEP_CALL = 'Call model'
const STEP_RETRY = 'Retry model call'
const STEP_PARSE = 'Parse and validate'

const EMPTY_REPLY = 'The model returned an empty response. Please try again.'

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

/** Totals across every attempt, since each attempt was billed. */
async function buildUsage(model: string | null, usages: RawUsage[], deadline: number): Promise<Usage> {
  const prompt = sumOrNull(usages.map(u => u.prompt_tokens))
  const completion = sumOrNull(usages.map(u => u.completion_tokens))
  const total = sumOrNull(usages.map(u => u.total_tokens))
  const reported = sumOrNull(usages.map(u => u.cost))
  if (reported !== null) {
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total, cost: reported, cost_source: 'reported' }
  }
  const estimated =
    model !== null && prompt !== null && completion !== null ? await estimateCost(model, prompt, completion, deadline) : null
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
  events.start(STEP_CALL)
  const called = Date.now()
  const first = await callModel(apiKey, messages, callLimit(), signal)

  const usages: RawUsage[] = []
  let attempt: AttemptOk | null = null
  // Why a second call is made, or null when the first one is used as it is.
  let reason: string | null = null
  if (first.ok) {
    usages.push(first.usage)
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
    usages.push(second.usage)
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
  const model = attempt.model ?? (first.ok ? first.model : null)
  const usage = await buildUsage(model, usages, deadline)
  const cited = parsed.result.source_chunk_indices.length
  const confidence = Math.round(parsed.result.confidence * 100)
  const estimateNote = usage.cost_source === 'estimated' ? ' Cost estimated from catalogue pricing.' : ''
  record(STEP_PARSE, parsing, 'ok', `Answer cites ${cited} ${noun(cited)}. Self-rated ${confidence}%.${estimateNote}`)

  return { ok: true, result: parsed.result, trace, usage, model, totalMs: Date.now() - started }
}
