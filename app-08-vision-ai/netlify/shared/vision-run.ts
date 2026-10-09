import { missingParts } from './compare'
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
  /** Comparison replies must carry all three parts before the run counts as complete. */
  mode?: string
}

// One deadline covers the whole run, connecting and reading the answer alike, retry included.
// It is counted from the start of the request and stays well under Netlify's 60-second limit.
export const UPSTREAM_BUDGET_MS = 25_000
// A healthy call starts to answer within about 6 seconds; 9 seconds without a first word is a hang.
// The one retry only starts when it still has RETRY_MIN_LEFT_MS of the budget to work with.
export const FIRST_TEXT_LIMIT_MS = 9_000
export const RETRY_MIN_LEFT_MS = 10_000
const MODEL_STEP = 'Model call'
const VALIDATE_STEP = 'Parse and validate'
const EMPTY_MESSAGE = 'The AI provider returned an empty response. Try again in a moment.'
const UNEXPECTED_MESSAGE = 'The analysis stopped unexpectedly. Please retry with the same image.'
const INCOMPLETE_COMPARISON = 'The comparison came back without all three parts. Please run it again.'
const encoder = new TextEncoder()

// Streams one vision call to the browser as SSE frames:
//   step  - a trace step as it starts (status running) and as it finishes
//   text  - a streamed delta of the answer
//   complete / failed - the terminal frame, carrying trace, usage, model, totalMs
// The stream always ends with a data: [DONE] line.
export function streamVisionRun(run: VisionRun): Response {
  let upstreamAbort = new AbortController()
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

      // One try at the call. Returns 'hang' only when nothing was shown yet and the caller may try again;
      // every other ending has already been written to the trace and the terminal frame.
      const attempt = async (callStart: number, retried: boolean, mayRetry: boolean): Promise<'hang' | 'finished'> => {
        const state = newState()
        const fail = (stepDetail: string, message: string, truncated: boolean): 'finished' => {
          finish({ name: MODEL_STEP, status: 'failed', ms: Date.now() - callStart, detail: stepDetail })
          finish({ name: VALIDATE_STEP, status: 'skipped', detail: 'Skipped because the model call did not finish' })
          conclude({ stage: 'failed', error: message, truncated }, state)
          return 'finished'
        }
        upstreamAbort = new AbortController()
        const signal = upstreamAbort.signal
        let hung = false
        const deadlineTimer = setTimeout(() => upstreamAbort.abort(), Math.max(0, deadline - Date.now()))
        const firstTimer = mayRetry
          ? setTimeout(() => {
              hung = true
              upstreamAbort.abort()
            }, FIRST_TEXT_LIMIT_MS)
          : undefined
        const stopTimers = () => {
          clearTimeout(deadlineTimer)
          clearTimeout(firstTimer)
        }
        const emitText: Emit = frame => {
          if (typeof frame.text === 'string') clearTimeout(firstTimer)
          emit(frame)
        }
        // A first try that heard nothing is retried; one that was stopped by the visitor or the deadline is not.
        const hangOrFail = (stepDetail: string, message: string): 'hang' | 'finished' =>
          mayRetry && open && state.chunks === 0 && Date.now() < deadline ? 'hang' : fail(stepDetail, message, false)

        try {
          let upstream: Response
          try {
            // raceAbort ends the wait at the timer even when the fetch ignores the abort.
            upstream = await raceAbort(
              fetch(run.provider.url, {
                method: 'POST',
                signal,
                headers: { Authorization: `Bearer ${run.provider.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(chatBody(run.messages, run.maxTokens)),
              }),
              signal,
            )
          } catch (err) {
            if (!open) return 'finished'
            if (isAbortError(err)) {
              console.error('Upstream request stopped before a response arrived')
              return hung
                ? hangOrFail('No response from the AI provider', TIMEOUT_MESSAGE)
                : fail('No response from the AI provider within the time limit', TIMEOUT_MESSAGE, false)
            }
            console.error('Upstream request failed:', err instanceof Error ? err.name : 'unknown')
            return hangOrFail('Could not reach the AI provider', UNREACHABLE_MESSAGE)
          }

          if (!upstream.ok || !upstream.body) {
            void upstream.body?.cancel().catch(() => undefined)
            const message = upstream.ok ? EMPTY_MESSAGE : providerMessage(upstream.status)
            console.error('AI provider returned HTTP', upstream.status)
            return fail(message, message, false)
          }

          const outcome = await readUpstream(upstream.body, deadline, signal, state, emitText)
          if (!open) return 'finished'
          if (outcome === 'aborted' || outcome === 'watchdog') {
            if (hung && state.chunks === 0) return hangOrFail('No answer from the AI provider', TIMEOUT_MESSAGE)
            const detail = `Stopped at the ${UPSTREAM_BUDGET_MS / 1000}-second limit; partial output kept`
            return fail(detail, PARTIAL_TIMEOUT_MESSAGE, true)
          }
          if (outcome === 'dropped') {
            return hangOrFail('The connection to the AI provider dropped mid-answer', STREAM_ERROR_MESSAGE)
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
            detail: `${state.served ?? 'model not named in the response'}, ${state.chunks} text chunks${retried ? ', retried once' : ''}`,
            tokens: state.usage?.total_tokens,
            cost: state.usage?.cost,
          })

          const validateStart = Date.now()
          const problem = validate(state) ?? incompleteComparison(run.mode, state.text)
          const validateMs = Date.now() - validateStart
          if (problem) {
            finish({ name: VALIDATE_STEP, status: 'failed', ms: validateMs, detail: problem.detail })
            conclude({ stage: 'failed', error: problem.message, truncated: problem.truncated }, state)
            return 'finished'
          }
          finish({
            name: VALIDATE_STEP,
            status: 'ok',
            ms: validateMs,
            detail: `${state.text.length.toLocaleString('en-US')} characters, finish reason ${state.finishReason ?? 'not reported'}`,
          })
          conclude({ stage: 'complete', result: state.text }, state)
          return 'finished'
        } finally {
          stopTimers()
        }
      }

      const runCall = async (): Promise<void> => {
        const callStart = Date.now()
        emit({ stage: 'step', step: { name: MODEL_STEP, status: 'running', detail: 'Request sent to the vision model' } })
        const mayRetry = deadline - Date.now() - FIRST_TEXT_LIMIT_MS >= RETRY_MIN_LEFT_MS
        if ((await attempt(callStart, false, mayRetry)) !== 'hang') return
        console.error('Upstream gave no answer; retrying once')
        emit({
          stage: 'step',
          step: { name: MODEL_STEP, status: 'running', detail: `No answer within ${FIRST_TEXT_LIMIT_MS / 1000} seconds. Retried once` },
        })
        await attempt(callStart, true, false)
      }

      try {
        finish(run.checked)
        await runCall()
      } catch (err) {
        if (open) console.error('Vision run failed:', err instanceof Error ? err.name : 'unknown')
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

function incompleteComparison(mode: string | undefined, text: string) {
  if (mode !== 'compare') return null
  const missing = missingParts(text)
  if (missing.length === 0) return null
  return { detail: `The reply has no ${missing.join(' or ')}`, message: INCOMPLETE_COMPARISON, truncated: false }
}

// Reads the provider stream until it ends, the shared deadline passes, or the connection fails.
async function readUpstream(
  body: ReadableStream<Uint8Array>,
  deadline: number,
  signal: AbortSignal,
  state: ReadState,
  emit: Emit,
): Promise<'ended' | 'watchdog' | 'dropped' | 'aborted'> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return 'watchdog'
      if (signal.aborted) return 'aborted'
      let timer: ReturnType<typeof setTimeout> | undefined
      const next = reader.read()
      // If the watchdog wins, nobody awaits this read; swallow its rejection.
      next.catch(() => undefined)
      let chunk: ReadableStreamReadResult<Uint8Array> | 'watchdog' | 'aborted'
      const onAbort = () => resolveAbort?.('aborted')
      let resolveAbort: ((value: 'aborted') => void) | undefined
      try {
        chunk = await Promise.race([
          next,
          new Promise<'watchdog'>(resolve => {
            timer = setTimeout(() => resolve('watchdog'), remaining)
          }),
          new Promise<'aborted'>(resolve => {
            resolveAbort = resolve
            signal.addEventListener('abort', onAbort, { once: true })
          }),
        ])
      } catch {
        return signal.aborted ? 'aborted' : 'dropped'
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
      if (chunk === 'watchdog') return 'watchdog'
      if (chunk === 'aborted') return 'aborted'
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
