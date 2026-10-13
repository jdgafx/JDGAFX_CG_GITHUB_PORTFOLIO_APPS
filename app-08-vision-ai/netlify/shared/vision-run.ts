import { missingParts } from './compare'
import { raceAbort } from './deadline'
import { MODEL, chatBody, type ChatMessage, type Provider } from './provider'
import { newestModel, servedCheck, worstCheck, type NewestSource } from './newest-model'
import {
  NO_ANALYSIS_MESSAGE,
  PARTIAL_TIMEOUT_MESSAGE,
  STREAM_ERROR_MESSAGE,
  TIMEOUT_MESSAGE,
  UNREACHABLE_MESSAGE,
  absorb,
  newState,
  providerMessage,
  totalUsage,
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
  /** Where the newest model comes from. The live list by default; tests pass a stub so no list is read. */
  newest?: NewestSource
}

// One deadline covers the whole run, connecting and reading the answer alike, retry included.
// It is counted from the start of the request and stays under Netlify's 30-second cut-off, leaving 5 seconds to close the stream.
export const UPSTREAM_BUDGET_MS = 25_000
// The model thinks before it writes, and its reasoning arrives as one signed item at the end of thinking. While it works the
// provider sends a comment line (": OPENROUTER PROCESSING") about every 0.4 seconds. Any byte on the stream, those comments
// included, shows the call is alive and ends the first-word watch, so a long think is never cut short and never retried.
// Only 12 seconds of nothing at all (no response, or a stream with no bytes) is a hang. The 25-second budget is the real limit.
// The one retry only starts when the budget left can hold a whole call: RETRY_MIN_LEFT_MS is the slowest of 20 measured
// thinking-on single-image calls (13,293 ms, an Extract replay; the SP2 browser runs and replays were 8 to 11.4 s) plus a 20% margin.
// After a 12-second wait only 13 seconds are left, so a call that says nothing is not retried and ends with the timeout message
// at the deadline; a call that fails at once (no connection) still has about 25 seconds and is retried.
export const FIRST_TEXT_LIMIT_MS = 12_000
export const RETRY_MIN_LEFT_MS = 16_000
const MODEL_STEP = 'Model call'
const FIRST_TRY_STEP = 'Model call (first try)'
const VALIDATE_STEP = 'Parse and validate'
const EMPTY_MESSAGE = 'The AI provider returned an empty response. Try again in a moment.'
const UNEXPECTED_MESSAGE = 'The analysis stopped unexpectedly. Please retry with the same image.'
const INCOMPLETE_COMPARISON = 'The comparison came back without all three parts. Please run it again.'
const encoder = new TextEncoder()

// Streams one vision call to the browser as SSE frames:
//   step  - a trace step as it starts (status running) and as it finishes
//   text  - a streamed delta of the answer
//   complete / failed - the terminal frame, carrying trace, usage, servedModel, the newest-model check, totalMs
// The stream always ends with a data: [DONE] line.
export function streamVisionRun(run: VisionRun): Response {
  let upstreamAbort = new AbortController()
  const deadline = run.startedAt + UPSTREAM_BUDGET_MS
  const trace: TraceStep[] = []
  // Every attempt of this run, retry included. A try that never got an answer has nothing to check, but its usage still counts as not reported.
  const calls: ReadState[] = []
  // One list read per run, started before the first model call and awaited only when the run ends.
  const newestP = (run.newest ?? newestModel)()
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
      const conclude = async (frame: Record<string, unknown>, state?: ReadState) => {
        const newest = await newestP
        // A try that got headers but no words and no model name said nothing about the model, so it is left out.
        const checked = calls
          .filter(call => call.served !== null || call.chunks > 0)
          .map(call => ({ served: call.served, check: servedCheck(newest, call.served) }))
        for (const call of checked) {
          if (call.check === 'mismatch') console.warn(`model mismatch: served ${call.served}, newest ${newest}, requested ${MODEL}`)
        }
        const billed = totalUsage(calls)
        emit({
          ...frame,
          trace,
          usage: billed.usage,
          usageNotReported: billed.notReported,
          servedModel: state?.served ?? null,
          newestModel: newest,
          modelCheck: checked.length === 0 ? 'not-reported' : worstCheck(checked.map(call => call.check)),
          mismatchedModel: checked.find(call => call.check === 'mismatch')?.served ?? null,
          totalMs: Date.now() - run.startedAt,
        })
      }

      // One try at the call. Returns 'hang' only when nothing was shown yet and the caller may try again;
      // every other ending has already been written to the trace and the terminal frame.
      const attempt = async (callStart: number, retried: boolean): Promise<'hang' | 'finished'> => {
        const state = newState()
        calls.push(state)
        const fail = async (stepDetail: string, message: string, truncated: boolean): Promise<'finished'> => {
          finish({ name: MODEL_STEP, status: 'failed', ms: Date.now() - callStart, detail: stepDetail, tokens: state.usage?.total_tokens, cost: state.usage?.cost })
          finish({ name: VALIDATE_STEP, status: 'skipped', detail: 'Skipped because the model call did not finish' })
          await conclude({ stage: 'failed', error: message, truncated }, state)
          return 'finished'
        }
        upstreamAbort = new AbortController()
        const signal = upstreamAbort.signal
        let hung = false
        const deadlineTimer = setTimeout(() => upstreamAbort.abort(), Math.max(0, deadline - Date.now()))
        // The first-word watch only runs when a retry started after it would still fit the budget.
        const watching = !retried && deadline - Date.now() - FIRST_TEXT_LIMIT_MS >= RETRY_MIN_LEFT_MS
        const firstTimer = watching
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
        // A reasoning delta shows the model is working on the answer, so the first-word watch ends there too.
        const heard = () => {
          if (state.reasoningChunks > 0 || state.chunks > 0) clearTimeout(firstTimer)
        }
        // A first try that heard nothing is retried; one that was stopped by the visitor or the deadline is not.
        const hangOrFail = async (stepDetail: string, message: string): Promise<'hang' | 'finished'> =>
          !retried && open && state.chunks === 0 && deadline - Date.now() >= RETRY_MIN_LEFT_MS ? 'hang' : fail(stepDetail, message, false)

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
            if (!upstream.ok) state.refused = true
            const message = upstream.ok ? EMPTY_MESSAGE : providerMessage(upstream.status)
            console.error('AI provider returned HTTP', upstream.status)
            return fail(message, message, false)
          }

          const outcome = await readUpstream(upstream.body, deadline, signal, state, emitText, heard, () => clearTimeout(firstTimer))
          if (!open) return 'finished'
          if (outcome === 'aborted' || outcome === 'watchdog') {
            if (hung && state.chunks === 0) return hangOrFail('No answer from the AI provider', TIMEOUT_MESSAGE)
            // Nothing was ever written, so there is no partial answer to point at.
            if (state.chunks === 0) return fail('No answer from the AI provider within the time limit', TIMEOUT_MESSAGE, false)
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
            await conclude({ stage: 'failed', error: problem.message, truncated: problem.truncated }, state)
            return 'finished'
          }
          finish({
            name: VALIDATE_STEP,
            status: 'ok',
            ms: validateMs,
            detail: `${state.text.length.toLocaleString('en-US')} characters, finish reason ${state.finishReason ?? 'not reported'}`,
          })
          await conclude({ stage: 'complete', result: state.text }, state)
          return 'finished'
        } finally {
          stopTimers()
        }
      }

      const runCall = async (): Promise<void> => {
        const callStart = Date.now()
        emit({ stage: 'step', step: { name: MODEL_STEP, status: 'running', detail: 'Request sent to the vision model' } })
        if ((await attempt(callStart, false)) !== 'hang') return
        console.error('Upstream gave no answer; retrying once')
        // The first try keeps its own row, with whatever usage it reported, so a retry never hides what it cost.
        const first = calls[0]
        finish({
          name: FIRST_TRY_STEP,
          status: 'failed',
          ms: Date.now() - callStart,
          detail: `The first try got no answer; usage ${first?.usage ? 'as reported' : 'not reported'}`,
          tokens: first?.usage?.total_tokens,
          cost: first?.usage?.cost,
        })
        emit({
          stage: 'step',
          step: { name: MODEL_STEP, status: 'running', detail: 'The first try got no answer. Retried once' },
        })
        await attempt(callStart, true)
      }

      try {
        finish(run.checked)
        await runCall()
      } catch (err) {
        if (open) console.error('Vision run failed:', err instanceof Error ? err.name : 'unknown')
        await conclude({ stage: 'failed', error: UNEXPECTED_MESSAGE, truncated: false })
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
  heard: () => void,
  alive: () => void,
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
      // Any bytes, comment lines included, show the provider is still working.
      if (chunk.value.length > 0) alive()
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        absorb(line, state, emit)
        heard()
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
