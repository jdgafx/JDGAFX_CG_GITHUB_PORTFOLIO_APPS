// Reads the chat stream from the provider: absorbs each data line, decides whether the
// reply is usable, and turns provider failures into plain words. The provider's own
// error body is never forwarded to the browser.
import { isRecord } from './guards'

interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost?: number
}

export interface ReadState {
  text: string
  chunks: number
  /** Reasoning deltas seen. They prove the model is working, and are never shown as the answer. */
  reasoningChunks: number
  finishReason: string | null
  served: string | null
  usage: Usage | null
  moderated: boolean
  providerError: boolean
  /** The provider answered with an HTTP error status: the request was refused, so nothing was billed. */
  refused: boolean
}

interface Problem {
  detail: string
  message: string
  truncated: boolean
}

export interface UsageTotal {
  usage: Usage | null
  /** Attempts whose usage never arrived (no answer, a stream cut before its usage chunk). The total is then a minimum. */
  notReported: number
}

/** The billed usage of every attempt of a run, retries included. A refused request billed nothing and is not counted as missing. */
export function totalUsage(states: ReadState[]): UsageTotal {
  let usage: Usage | null = null
  let notReported = 0
  const add = (a: number | undefined, b: number | undefined) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0))
  for (const state of states) {
    if (!state.usage) {
      if (!state.refused) notReported += 1
      continue
    }
    const sum = (key: keyof Usage) => add(usage?.[key], state.usage?.[key])
    const cost = sum('cost')
    usage = {
      prompt_tokens: sum('prompt_tokens'),
      completion_tokens: sum('completion_tokens'),
      total_tokens: sum('total_tokens'),
      ...(cost === undefined ? {} : { cost: Math.round(cost * 1e9) / 1e9 }),
    }
  }
  return { usage, notReported }
}

export type Emit = (frame: Record<string, unknown>) => void

// A reply served by a moderation model is never shown as the analysis.
const MODERATION_MARKER = 'content-safety'

export const TIMEOUT_MESSAGE = 'The AI provider did not answer in time.'
export const PARTIAL_TIMEOUT_MESSAGE =
  'The AI provider did not answer in time. The partial answer above may be incomplete.'
export const UNREACHABLE_MESSAGE = 'Could not reach the AI provider. Try again in a moment.'
export const STREAM_ERROR_MESSAGE = 'The AI provider stopped the analysis partway through. Please retry.'
export const NO_ANALYSIS_MESSAGE = 'The vision service returned no usable analysis. Please retry with the same image.'
const THINKING_CUT_MESSAGE =
  'The AI model used its whole output limit thinking and wrote no answer. Please retry with the same image.'
const TRUNCATED_MESSAGE = 'The vision service stopped before the analysis finished. Please retry with the same image.'
const REJECTED_MESSAGE = 'The AI provider rejected the key or is out of credit.'
const RATE_LIMIT_MESSAGE = 'Rate limited, try again in a minute.'
const REFUSED_IMAGE_MESSAGE = 'The AI provider could not process this image.'

export function newState(): ReadState {
  return { text: '', chunks: 0, reasoningChunks: 0, finishReason: null, served: null, usage: null, moderated: false, providerError: false, refused: false }
}

// Absorbs one line of the stream. Text deltas are emitted as they arrive; the moderation
// check runs before any text from the same chunk is emitted.
export function absorb(line: string, state: ReadState, emit: Emit): void {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === '[DONE]') return
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return // a malformed or keep-alive frame carries nothing to read
  }
  if (!isRecord(parsed)) return
  if (parsed.error !== undefined) {
    state.providerError = true
    return
  }
  if (typeof parsed.model === 'string') {
    state.served = parsed.model
    if (parsed.model.includes(MODERATION_MARKER)) {
      state.moderated = true
      return
    }
  }
  // OpenRouter sends usage on the final chunk, which usually has no choices.
  if (isRecord(parsed.usage)) state.usage = readUsage(parsed.usage)
  const choice = firstChoice(parsed.choices)
  if (choice && typeof choice.finish_reason === 'string') state.finishReason = choice.finish_reason
  const deltaRecord = choice && isRecord(choice.delta) ? choice.delta : null
  // Reasoning arrives as delta.reasoning and/or delta.reasoning_details. It is counted, never emitted or kept as text.
  if (
    deltaRecord &&
    ((typeof deltaRecord.reasoning === 'string' && deltaRecord.reasoning !== '') ||
      (Array.isArray(deltaRecord.reasoning_details) && deltaRecord.reasoning_details.length > 0))
  ) {
    state.reasoningChunks += 1
  }
  const delta = deltaRecord ? deltaRecord.content : undefined
  if (typeof delta === 'string' && delta) {
    state.text += delta
    state.chunks += 1
    emit({ text: delta })
  }
}

// Decides whether a finished reply can be shown. A null result means it can.
export function validate(state: ReadState): Problem | null {
  // Thinking can use up max_tokens before any answer is written: content comes back empty with finish reason 'length'.
  // That is an error, never an empty answer passed off as done, and there is no partial answer to point at.
  if (state.finishReason === 'length' && !state.text.trim()) {
    return {
      detail: 'The token limit was used up by thinking before any answer was written',
      message: THINKING_CUT_MESSAGE,
      truncated: false,
    }
  }
  if (state.finishReason === 'length') {
    return {
      detail: 'Output reached the token limit before the analysis finished',
      message: TRUNCATED_MESSAGE,
      truncated: true,
    }
  }
  // A stream that closes with text but never names a finish reason was cut off (a dropped connection), so the text is not a complete answer.
  if (state.finishReason === null && state.text.trim()) {
    return {
      detail: 'The stream ended without a finish reason, so the answer may be cut off',
      message: STREAM_ERROR_MESSAGE,
      truncated: true,
    }
  }
  if (state.finishReason === 'content_filter') {
    return { detail: 'The provider filtered this output', message: NO_ANALYSIS_MESSAGE, truncated: false }
  }
  if (!state.text.trim()) {
    return { detail: 'No text was returned', message: NO_ANALYSIS_MESSAGE, truncated: false }
  }
  return null
}

export function providerMessage(status: number): string {
  if (status === 401 || status === 402 || status === 403) return REJECTED_MESSAGE
  if (status === 429) return RATE_LIMIT_MESSAGE
  if (status >= 500) return TIMEOUT_MESSAGE
  return REFUSED_IMAGE_MESSAGE
}

export function readUsage(raw: Record<string, unknown>): Usage {
  const pick = (key: string): number | undefined => {
    const value = raw[key]
    return typeof value === 'number' ? value : undefined
  }
  return {
    prompt_tokens: pick('prompt_tokens'),
    completion_tokens: pick('completion_tokens'),
    total_tokens: pick('total_tokens'),
    cost: pick('cost'),
  }
}

function firstChoice(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null
  const first: unknown = value[0]
  return isRecord(first) ? first : null
}
