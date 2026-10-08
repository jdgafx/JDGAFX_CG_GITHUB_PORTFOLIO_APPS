import { callModel, estimateCost, type AttemptOk, type ChatMessage, type ProviderConfig, type RawUsage } from './provider'

export interface AnswerInput {
  question: string
  chunks: string[]
  documentTitle: string
}

export interface AiResponse {
  answer: string
  source_chunk_indices: number[]
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

export interface Usage {
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
export interface RunEvents {
  start: (name: string) => void
  step: (step: TraceStep) => void
}

// Netlify caps a synchronous function invocation at ~30s. One deadline covers
// the first call and the retry together, so a retry cannot double the wait.
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 25_000)

// The browser repeats these names for steps it skips when no passage matches,
// so keep the two lists in step.
export const STEP_ACCEPT = 'Accept request'
export const STEP_BUILD = 'Build prompt'
export const STEP_CALL = 'Call model'
export const STEP_RETRY = 'Retry model call'
export const STEP_PARSE = 'Parse and validate'

const SYSTEM_PROMPT = `You are DocMind, an intelligent document Q&A assistant. You answer questions based ONLY on the provided document chunks.

Rules:
- Answer using ONLY information explicitly found in the provided chunks
- If the chunks don't contain enough information to answer, clearly say so
- Never fabricate or infer information beyond what is in the chunks
- Be precise, clear, and cite which chunks contain the relevant information

Confidence scoring:
- 0.8-1.0: The chunks directly and clearly answer the question
- 0.5-0.79: Partial or indirect answer found in chunks
- 0.0-0.49: Limited or no relevant information in the provided chunks

You MUST respond with ONLY a valid JSON object in this exact format (no markdown, no extra text):
{"answer":"your detailed answer here","source_chunk_indices":[0,2,5],"confidence":0.85}

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

function parseAnswer(content: string): ParsedAnswer {
  if (content.trim() === '') {
    return { ok: false, message: 'The model returned an empty response. Please try again.' }
  }
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
  return {
    ok: true,
    result: {
      answer,
      source_chunk_indices: indices.filter((i): i is number => typeof i === 'number' && Number.isInteger(i)),
      confidence: Math.min(1, Math.max(0, confidence)),
    },
  }
}

/**
 * The retry rule: keep an answer that is non-empty and was not cut off, or any
 * answer that stopped cleanly. Anything else gets one more call.
 */
function usable(attempt: AttemptOk): boolean {
  return (attempt.content.trim() !== '' && attempt.finishReason !== 'length') || attempt.finishReason === 'stop'
}

function sumOrNull(values: Array<number | null>): number | null {
  if (values.some(v => v === null)) return null
  return values.reduce<number>((total, v) => total + (v ?? 0), 0)
}

/** Totals across every attempt, since each attempt was billed. */
async function buildUsage(model: string | null, usages: RawUsage[]): Promise<Usage> {
  const prompt = sumOrNull(usages.map(u => u.prompt_tokens))
  const completion = sumOrNull(usages.map(u => u.completion_tokens))
  const total = sumOrNull(usages.map(u => u.total_tokens))
  const reported = sumOrNull(usages.map(u => u.cost))
  if (reported !== null) {
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total, cost: reported, cost_source: 'reported' }
  }
  const estimated = model !== null && prompt !== null && completion !== null ? await estimateCost(model, prompt, completion) : null
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
 * made before this function was called.
 */
export async function runAnswer(
  input: AnswerInput,
  provider: ProviderConfig,
  started: number,
  events: RunEvents,
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
  record(STEP_ACCEPT, started, 'ok', `Question and ${input.chunks.length} passages checked.`)

  events.start(STEP_BUILD)
  const built = Date.now()
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(input.question, input.chunks, input.documentTitle) },
  ]
  const characters = messages.reduce((total, m) => total + m.content.length, 0)
  record(STEP_BUILD, built, 'ok', `System prompt and ${input.chunks.length} passages, ${characters} characters in total.`)

  const deadline = started + UPSTREAM_TIMEOUT_MS
  events.start(STEP_CALL)
  const called = Date.now()
  const first = await callModel(provider, messages, deadline)
  if (!first.ok) {
    record(STEP_CALL, called, 'failed', first.message)
    return fail(first.status, first.message, [STEP_PARSE])
  }

  const usages: RawUsage[] = [first.usage]
  let attempt: AttemptOk = first
  if (usable(first)) {
    record(STEP_CALL, called, 'ok', servedBy(first), costOf(first))
  } else {
    record(STEP_CALL, called, 'failed', 'Output was empty or cut off. Asking the model again.', costOf(first))
    events.start(STEP_RETRY)
    const retried = Date.now()
    const second = await callModel(provider, messages, deadline)
    if (!second.ok) {
      record(STEP_RETRY, retried, 'failed', second.message)
      return fail(second.status, second.message, [STEP_PARSE])
    }
    usages.push(second.usage)
    attempt = second
    record(STEP_RETRY, retried, 'ok', servedBy(second), costOf(second))
  }

  events.start(STEP_PARSE)
  const parsing = Date.now()
  const parsed = parseAnswer(attempt.content)
  if (!parsed.ok) {
    record(STEP_PARSE, parsing, 'failed', parsed.message)
    return fail(502, parsed.message, [])
  }
  const model = attempt.model ?? first.model
  const usage = await buildUsage(model, usages)
  const cited = parsed.result.source_chunk_indices.length
  const confidence = Math.round(parsed.result.confidence * 100)
  const estimateNote = usage.cost_source === 'estimated' ? ' Cost estimated from catalogue pricing.' : ''
  record(STEP_PARSE, parsing, 'ok', `Answer cites ${cited} passage${cited === 1 ? '' : 's'}. Self-rated ${confidence}%.${estimateNote}`)

  return { ok: true, result: parsed.result, trace, usage, model, totalMs: Date.now() - started }
}
