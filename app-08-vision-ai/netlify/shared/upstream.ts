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
  finishReason: string | null
  served: string | null
  usage: Usage | null
  moderated: boolean
  providerError: boolean
}

interface Problem {
  detail: string
  message: string
  truncated: boolean
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
const TRUNCATED_MESSAGE = 'The vision service stopped before the analysis finished. Please retry with the same image.'
const REJECTED_MESSAGE = 'The AI provider rejected the key or is out of credit.'
const RATE_LIMIT_MESSAGE = 'Rate limited, try again in a minute.'
const REFUSED_IMAGE_MESSAGE = 'The AI provider could not process this image.'

export function newState(): ReadState {
  return { text: '', chunks: 0, finishReason: null, served: null, usage: null, moderated: false, providerError: false }
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
  const delta = choice && isRecord(choice.delta) ? choice.delta.content : undefined
  if (typeof delta === 'string' && delta) {
    state.text += delta
    state.chunks += 1
    emit({ text: delta })
  }
}

// Decides whether a finished reply can be shown. A null result means it can.
export function validate(state: ReadState): Problem | null {
  if (state.finishReason === 'length') {
    return {
      detail: 'Output reached the token limit before the analysis finished',
      message: TRUNCATED_MESSAGE,
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
