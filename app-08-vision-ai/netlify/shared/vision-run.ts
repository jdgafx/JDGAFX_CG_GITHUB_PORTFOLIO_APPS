import { raceAbort } from './deadline'
import { chatBody, type ChatMessage, type Provider } from './provider'
import {
  NO_ANALYSIS_MESSAGE,
  PARTIAL_TIMEOUT_MESSAGE,
  STREAM_ERROR_MESSAGE,
  TIMEOUT_MESSAGE,
  UNREACHABLE_MESSAGE,
  absorb,
  newState,
  providerMessage,
  validate,
  type Emit,
  type ReadState,
} from './upstream'

export interface TraceStep {
  name: string
  status: 'running' | 'ok' | 'failed' | 'skipped'
  ms?: number
  detail: string
  tokens?: number
  cost?: number
}

export interface VisionRun {
  provider: Provider
  messages: ChatMessage[]
  maxTokens: number
  startedAt: number
  checked: TraceStep
}

// One deadline covers the whole provider call, connecting and reading the answer alike.
// It is counted from the start of the request and stays well under Netlify's 60-second limit.
export const UPSTREAM_BUDGET_MS = 25_000
const MODEL_STEP = 'Model call'
const VALIDATE_STEP = 'Parse and validate'
const EMPTY_MESSAGE = 'The AI provider returned an empty response. Try again in a moment.'
const UNEXPECTED_MESSAGE = 'The analysis stopped unexpectedly. Please retry with the same image.'
const encoder = new TextEncoder()

// Streams one vision call to the browser as SSE frames:
//   step  - a trace step as it starts (status running) and as it finishes
//   text  - a streamed delta of the answer
//   complete / failed - the terminal frame, carrying trace, usage, model, totalMs
// The stream always ends with a data: [DONE] line.
export function streamVisionRun(run: VisionRun): Response {
  const upstreamAbort = new AbortController()
  const deadline = run.startedAt + UPSTREAM_BUDGET_MS
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
      const conclude = (frame: Record<string, unknown>, state?: ReadState) => {
        emit({ ...frame, trace, usage: state?.usage ?? null, model: state?.served ?? null, totalMs: Date.now() - run.startedAt })
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
        // Connecting may only use what is left of the shared deadline.
        const connectTimer = setTimeout(() => upstreamAbort.abort(), Math.max(0, deadline - Date.now()))
        let upstream: Response
        try {
          // raceAbort ends the wait at the timer even when the fetch ignores the abort.
          upstream = await raceAbort(
            fetch(run.provider.url, {
              method: 'POST',
              signal: upstreamAbort.signal,
              headers: { Authorization: `Bearer ${run.provider.apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(chatBody(run.messages, run.maxTokens)),
            }),
            upstreamAbort.signal,
          )
        } catch (err) {
          clearTimeout(connectTimer)
          if (isAbortError(err)) {
            console.error('Upstream request stopped before a response arrived')
            return fail('No response from the AI provider within the time limit', TIMEOUT_MESSAGE, false)
          }
          console.error('Upstream request failed:', err instanceof Error ? err.name : 'unknown')
          return fail('Could not reach the AI provider', UNREACHABLE_MESSAGE, false)
        }
        clearTimeout(connectTimer)

        if (!upstream.ok || !upstream.body) {
          void upstream.body?.cancel().catch(() => undefined)
          const message = upstream.ok ? EMPTY_MESSAGE : providerMessage(upstream.status)
          console.error('AI provider returned HTTP', upstream.status)
          return fail(message, message, false)
        }

        const outcome = await readUpstream(upstream.body, deadline, state, emit)
        if (outcome === 'watchdog') {
          const detail = `Stopped at the ${UPSTREAM_BUDGET_MS / 1000}-second limit; partial output kept`
          return fail(detail, PARTIAL_TIMEOUT_MESSAGE, true)
        }
        if (outcome === 'dropped') {
          return fail('The connection to the AI provider dropped mid-answer', STREAM_ERROR_MESSAGE, false)
        }
        if (state.providerError) {
          return fail('The provider ended the stream with an error', STREAM_ERROR_MESSAGE, false)
        }
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
        conclude({ stage: 'failed', error: UNEXPECTED_MESSAGE, truncated: false })
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
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  })
}

// Reads the provider stream until it ends, the shared deadline passes, or the connection fails.
async function readUpstream(
  body: ReadableStream<Uint8Array>,
  deadline: number,
  state: ReadState,
  emit: Emit,
): Promise<'ended' | 'watchdog' | 'dropped'> {
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
      let chunk: ReadableStreamReadResult<Uint8Array> | 'watchdog'
      try {
        chunk = await Promise.race([
          next,
          new Promise<'watchdog'>(resolve => {
            timer = setTimeout(() => resolve('watchdog'), remaining)
          }),
        ])
      } catch {
        return 'dropped'
      } finally {
        clearTimeout(timer)
      }
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

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError'
}
