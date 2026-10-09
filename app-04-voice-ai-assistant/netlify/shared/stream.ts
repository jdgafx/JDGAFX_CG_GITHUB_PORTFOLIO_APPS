// One streamed chat call to OpenRouter. Text goes to `onText` as it arrives; tool calls are
// collected by index (their arguments arrive in fragments). Three clocks guard the call: no data
// event within `firstByteMs` (the provider hang that shows up in about 2 to 3 percent of calls),
// no event for `idleMs` once data flows, and the run's deadline. Failures come back as data.

import { raceAbort } from './deadline'
import { providerFailure, upstreamStatus } from './http'
import { createSseParser } from './sse'
import { labelShaped, unsuitableModel, GATE_CHARS } from './reply-guard'

export const MODEL = 'anthropic/claude-haiku-5.5'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const PROVIDER = 'The AI provider'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

// A message as OpenRouter takes it. The browser only ever supplies the first kind.
export type Turn =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost?: number
}

export interface StreamOptions {
  maxTokens: number
  tools: readonly unknown[]
  toolChoice?: 'none'
  // Aborts the call when the visitor stops, so nothing keeps running (or billing) behind them.
  cancel?: AbortSignal
  deadlineAt: number
  firstByteMs: number
  idleMs: number
  onText: (delta: string) => void
}

export type StreamOutcome =
  | {
      ok: true
      text: string
      toolCalls: ToolCall[]
      usage?: Usage
      model?: string
      finishReason?: string
      // Time from the request to the first text, when there was text.
      firstTextMs?: number
    }
  | {
      ok: false
      httpStatus: number
      message: string
      detail: string
      // True when nothing was heard from the provider, so a second try cannot repeat anything.
      retryable: boolean
    }

type Failure = Extract<StreamOutcome, { ok: false }>

function failure(httpStatus: number, message: string, detail: string, retryable = false): Failure {
  return { ok: false, httpStatus, message, detail, retryable }
}

interface Delta {
  content?: unknown
  tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>
}

interface Chunk {
  model?: string
  error?: unknown
  choices?: Array<{ delta?: Delta; finish_reason?: string | null }>
  usage?: Usage
}

export async function streamChat(apiKey: string, turns: Turn[], options: StreamOptions): Promise<StreamOutcome> {
  const started = Date.now()
  const control = new AbortController()
  let why: 'first-byte' | 'idle' | 'deadline' | 'cancelled' | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (ms: number, reason: typeof why) => {
    clearTimeout(timer)
    const left = Math.max(0, options.deadlineAt - Date.now())
    const limit = left <= ms ? 'deadline' : reason
    timer = setTimeout(() => {
      why = limit
      control.abort()
    }, Math.min(ms, left))
  }
  const onCancel = () => {
    why = 'cancelled'
    control.abort()
  }
  if (options.cancel?.aborted) return failure(499, 'Stopped.', 'Stopped by you')
  options.cancel?.addEventListener('abort', onCancel, { once: true })

  let text = ''
  let emitted = false
  let held = ''
  let gotData = false
  let firstTextMs: number | undefined
  let model: string | undefined
  let usage: Usage | undefined
  let finishReason: string | undefined
  const tools = new Map<number, ToolCall>()

  const refused = (detail: string): Failure => {
    console.error(`ai: rejected a label-shaped reply from ${model ?? 'unknown'}`)
    return failure(502, 'The model returned a label instead of a reply. Try again.', detail)
  }

  // Text is held until it is long enough to tell it is not a safety label.
  const release = (delta: string) => {
    if (!emitted) {
      held += delta
      if (held.length < GATE_CHARS) return true
      if (labelShaped(held)) return false
      emitted = true
      const first = held.trimStart()
      held = ''
      if (first) options.onText(first)
      return true
    }
    options.onText(delta)
    return true
  }

  try {
    arm(options.firstByteMs, 'first-byte')
    const response = await raceAbort(
      fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: control.signal,
        body: JSON.stringify({
          model: MODEL,
          max_tokens: options.maxTokens,
          // Reasoning tokens count against max_tokens, so a reasoning route could
          // use up the budget and leave no room for the reply.
          reasoning: { enabled: false },
          // Asks OpenRouter to return token counts and cost with the last event.
          usage: { include: true },
          stream: true,
          // The tools stay listed on the answer call, because the messages now hold
          // tool calls. 'none' is what keeps that call to one round.
          tools: options.tools,
          ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
          messages: turns,
        }),
      }),
      control.signal,
    )
    if (!response.ok) {
      const body = await raceAbort(response.text().catch(() => '<unreadable>'), control.signal)
      // Vendor error text can carry account or billing detail. Log it, never ship it.
      console.error(`ai: upstream ${response.status}: ${body}`)
      return failure(upstreamStatus(response.status), providerFailure(PROVIDER, response.status), `HTTP ${response.status} from the AI provider`)
    }
    if (!response.body) return failure(502, `${PROVIDER} returned an unreadable response.`, 'The provider reply had no body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const parser = createSseParser()
    let finished = false
    while (!finished) {
      const { value, done } = await raceAbort(reader.read(), control.signal)
      if (done) break
      const fed = parser.feed(decoder.decode(value, { stream: true }))
      if (fed.comment) arm(gotData ? options.idleMs : options.firstByteMs, gotData ? 'idle' : 'first-byte')
      if (fed.done) finished = true
      for (const payload of fed.data) {
        let chunk: Chunk
        try {
          chunk = JSON.parse(payload) as Chunk
        } catch {
          continue
        }
        gotData = true
        arm(options.idleMs, 'idle')
        if (chunk.error) {
          console.error('ai: provider error event', JSON.stringify(chunk.error).slice(0, 300))
          return failure(502, `${PROVIDER} could not finish the reply.`, 'The provider sent an error event', !emitted && text === '')
        }
        if (chunk.model) {
          model = chunk.model
          if (unsuitableModel(model)) return refused('The reply was served by a moderation model, not a chat model')
        }
        if (chunk.usage) usage = chunk.usage
        const choice = chunk.choices?.[0]
        if (choice?.finish_reason) finishReason = choice.finish_reason
        const delta = choice?.delta
        if (typeof delta?.content === 'string' && delta.content) {
          text += delta.content
          firstTextMs ??= Date.now() - started
          if (!release(delta.content)) return refused('The reply was a moderation label, not an answer')
        }
        for (const piece of delta?.tool_calls ?? []) {
          const index = piece.index ?? 0
          const call = tools.get(index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
          if (piece.id) call.id = piece.id
          if (piece.function?.name) call.function.name += piece.function.name
          if (piece.function?.arguments) call.function.arguments += piece.function.arguments
          tools.set(index, call)
        }
      }
    }
    // A reply shorter than the gate is released now, after the same label check.
    if (!emitted && held) {
      if (labelShaped(held)) return refused('The reply was a moderation label, not an answer')
      emitted = true
      const first = held.trimStart()
      if (first) options.onText(first)
    }
    const toolCalls = [...tools.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call)
      .filter(call => call.id && call.function.name)
      .map(call => ({ ...call, function: { ...call.function, arguments: call.function.arguments || '{}' } }))
    return { ok: true, text: text.trim(), toolCalls, usage, model, finishReason, firstTextMs }
  } catch (err) {
    if (why === 'cancelled') return failure(499, 'Stopped.', 'Stopped by you')
    console.error('ai: upstream stream failed', why ?? err)
    // A hang or a drop before any data is safe to try again. After data, text may already be heard.
    const silent = !gotData
    if (why === 'first-byte' || why === 'idle' || why === 'deadline') {
      return failure(503, `${PROVIDER} did not answer in time.`, why === 'first-byte' ? 'No data before the first-byte limit' : 'No reply before the time limit', silent)
    }
    return failure(503, `${PROVIDER} could not be reached. Try again in a moment.`, 'The request did not reach the AI provider', silent)
  } finally {
    clearTimeout(timer)
    options.cancel?.removeEventListener('abort', onCancel)
    control.abort()
  }
}