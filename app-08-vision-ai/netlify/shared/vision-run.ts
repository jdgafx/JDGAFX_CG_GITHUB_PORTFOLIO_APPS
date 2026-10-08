import { chatBody, type ChatMessage, type Provider } from './provider'

export type StepStatus = 'running' | 'ok' | 'failed' | 'skipped'

export interface TraceStep {
  name: string
  status: StepStatus
  ms?: number
  detail: string
  tokens?: number
  cost?: number
}

export interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost?: number
}

export interface VisionRun {
  provider: Provider
  messages: ChatMessage[]
  maxTokens: number
  startedAt: number
  checked: TraceStep
  headers: Record<string, string>
}

type Emit = (frame: Record<string, unknown>) => void

interface ReadState {
  text: string
  chunks: number
  finishReason: string | null
  served: string | null
  usage: Usage | null
  moderated: boolean
  providerError: boolean
}

interface UpstreamChunk {
  error?: unknown
  model?: unknown
  usage?: unknown
  choices?: Array<{ finish_reason?: unknown; delta?: { content?: unknown } }>
}

const MODEL_STEP = 'Model call'
const VALIDATE_STEP = 'Parse and validate'
const STREAM_BUDGET_MS = 25_000
const CONNECT_TIMEOUT_MS = 20_000
const MODERATION_MARKER = 'content-safety'
const TRUNCATED_MESSAGE =
  'The vision service stopped before the analysis finished. Please retry with the same image.'
const NO_ANALYSIS_MESSAGE =
  'The vision service returned no usable analysis. Please retry with the same image.'
const STREAM_ERROR_MESSAGE = 'The AI provider stopped the analysis partway through. Please retry.'
const encoder = new TextEncoder()

// Streams one vision call to the browser as SSE frames:
//   step  - a trace step as it starts (status running) and as it finishes
//   text  - a streamed delta of the answer
//   complete / failed - the terminal frame, carrying trace, usage, model, totalMs
export function streamVisionRun(run: VisionRun): Response {
  const upstreamAbort = new AbortController()
  const trace: TraceStep[] = []
  let open = true

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = frame => {
        if (open) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
      }
      const finish = (step: TraceStep) => {
        trace.push(step)
        emit({ stage: 'step', step })
      }
      const conclude = (frame: Record<string, unknown>, state: ReadState) => {
        emit({ ...frame, trace, usage: state.usage, model: state.served, totalMs: Date.now() - run.startedAt })
      }

      const runCall = async (): Promise<void> => {
        const state = newState()
        const callStart = Date.now()
        const fail = (stepDetail: string, message: string, truncated: boolean) => {
          finish({ name: MODEL_STEP, status: 'failed', ms: Date.now() - callStart, detail: stepDetail })
          finish({ name: VALIDATE_STEP, status: 'skipped', detail: 'Skipped because the model call did not finish' })
          conclude({ stage: 'failed', error: message, truncated }, state)
        }

        emit({ stage: 'step', step: { name: MODEL_STEP, status: 'running', detail: 'Request sent to the vision model' } })
        let connectTimedOut = false
        const connectTimer = setTimeout(() => {
          connectTimedOut = true
          upstreamAbort.abort()
        }, CONNECT_TIMEOUT_MS)
        let upstream: Response
        try {
          upstream = await fetch(run.provider.url, {
            method: 'POST',
            signal: upstreamAbort.signal,
            headers: { Authorization: `Bearer ${run.provider.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(chatBody(run.messages, run.maxTokens)),
          })
        } catch (err) {
          clearTimeout(connectTimer)
          console.error('Upstream request failed:', err instanceof Error ? err.name : 'unknown')
          const message = connectTimedOut
            ? 'The AI provider did not respond in time. Try again in a moment.'
            : 'Could not reach the AI provider. Try again in a moment.'
          return fail(message, message, false)
        }
        clearTimeout(connectTimer)

        if (!upstream.ok || !upstream.body) {
          void upstream.body?.cancel().catch(() => undefined)
          const message = upstream.ok
            ? 'The AI provider returned an empty response. Try again in a moment.'
            : providerMessage(upstream.status)
          console.error('AI provider returned HTTP', upstream.status)
          return fail(message, message, false)
        }

        const outcome = await readUpstream(upstream.body, Date.now() + STREAM_BUDGET_MS, state, emit)
        if (outcome === 'watchdog') {
          return fail(
            `Stopped at the ${STREAM_BUDGET_MS / 1000} s limit; partial output kept`,
            TRUNCATED_MESSAGE,
            true,
          )
        }
        if (state.providerError) return fail('The provider ended the stream with an error', STREAM_ERROR_MESSAGE, false)
        if (state.moderated) {
          return fail('Answered by a moderation model, not the analysis model', NO_ANALYSIS_MESSAGE, false)
        }

        finish({
          name: MODEL_STEP,
          status: 'ok',
          ms: Date.now() - callStart,
          detail: `${state.served ?? 'model not named in the response'}, ${state.chunks} text chunks`,
          tokens: state.usage?.total_tokens,
          cost: state.usage?.cost,
        })

        const validateStart = Date.now()
        const problem = validate(state)
        const validateMs = Date.now() - validateStart
        if (problem) {
          finish({ name: VALIDATE_STEP, status: 'failed', ms: validateMs, detail: problem.detail })
          return conclude({ stage: 'failed', error: problem.message, truncated: problem.truncated }, state)
        }
        finish({
          name: VALIDATE_STEP,
          status: 'ok',
          ms: validateMs,
          detail: `${state.text.length.toLocaleString('en-US')} characters, finish reason ${state.finishReason ?? 'not reported'}`,
        })
        conclude({ stage: 'complete', result: state.text }, state)
      }

      try {
        finish(run.checked)
        await runCall()
      } catch (err) {
        if (!upstreamAbort.signal.aborted) console.error('Vision run failed:', err instanceof Error ? err.name : 'unknown')
        emit({
          stage: 'failed',
          error: 'The analysis stopped unexpectedly. Please retry with the same image.',
          truncated: false,
          trace,
          usage: null,
          model: null,
          totalMs: Date.now() - run.startedAt,
        })
      } finally {
        if (open) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          open = false
          controller.close()
        }
      }
    },
    cancel() {
      open = false
      upstreamAbort.abort()
    },
  })

  return new Response(stream, {
    headers: {
      ...run.headers,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

async function readUpstream(
  body: ReadableStream<Uint8Array>,
  deadline: number,
  state: ReadState,
  emit: Emit,
): Promise<'ended' | 'watchdog'> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return 'watchdog'
      let timer: ReturnType<typeof setTimeout> | undefined
      const next = reader.read()
      // If the watchdog wins, nobody awaits this read; swallow its rejection.
      next.catch(() => undefined)
      const chunk = await Promise.race([
        next,
        new Promise<'watchdog'>(resolve => {
          timer = setTimeout(() => resolve('watchdog'), remaining)
        }),
      ])
      clearTimeout(timer)
      if (chunk === 'watchdog') return 'watchdog'
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        absorb(line, state, emit)
        if (state.moderated || state.providerError) return 'ended'
      }
    }
    buffer += decoder.decode()
    absorb(buffer, state, emit)
    return 'ended'
  } finally {
    void reader.cancel().catch(() => undefined)
  }
}

function absorb(line: string, state: ReadState, emit: Emit): void {
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
  const chunk = parsed as UpstreamChunk
  if (chunk.error !== undefined) {
    state.providerError = true
    return
  }
  if (typeof chunk.model === 'string') {
    state.served = chunk.model
    // Check before any text from this chunk is emitted, so moderation output never reaches the browser.
    if (chunk.model.includes(MODERATION_MARKER)) {
      state.moderated = true
      return
    }
  }
  // OpenRouter sends usage on the final chunk, which usually has no choices.
  if (isRecord(chunk.usage)) state.usage = readUsage(chunk.usage)
  const choice = chunk.choices?.[0]
  if (typeof choice?.finish_reason === 'string') state.finishReason = choice.finish_reason
  const delta = choice?.delta?.content
  if (typeof delta === 'string' && delta) {
    state.text += delta
    state.chunks += 1
    emit({ text: delta })
  }
}

function validate(state: ReadState): { detail: string; message: string; truncated: boolean } | null {
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

// Plain words only: the provider body is never forwarded to the browser.
function providerMessage(status: number): string {
  if (status === 401 || status === 403) return 'The AI provider rejected the server credentials.'
  if (status === 402) return 'The AI provider is out of credit, so no analysis can run right now.'
  if (status === 413) return 'The image is too large for the AI provider.'
  if (status === 429) return 'The AI provider is rate limited. Try again in a moment.'
  if (status >= 500) return 'The AI provider failed. Try again in a moment.'
  return 'The AI provider could not process this image.'
}

function readUsage(raw: Record<string, unknown>): Usage {
  const pick = (key: string): number | undefined => (typeof raw[key] === 'number' ? (raw[key] as number) : undefined)
  return {
    prompt_tokens: pick('prompt_tokens'),
    completion_tokens: pick('completion_tokens'),
    total_tokens: pick('total_tokens'),
    cost: pick('cost'),
  }
}

function newState(): ReadState {
  return { text: '', chunks: 0, finishReason: null, served: null, usage: null, moderated: false, providerError: false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
