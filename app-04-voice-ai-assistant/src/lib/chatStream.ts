// The browser side of POST /api/ai, which answers as server-sent events: `step` for each trace step as
// the server finishes it, `delta` for each piece of the answer, then `done` or `error`. Three clocks
// watch the connection: nothing at all for FIRST_BYTE_MS (the request is tried once more), then no byte
// for IDLE_MS (the server pings every 10 s, so silence means a dead connection), and OVERALL_MS for the
// whole reply (the server's run budget is 25 s). The visitor's own Stop is not a stall: it passes through.
import { createSseParser } from '../../netlify/shared/sse'
import {
  RunError,
  numberOrUndefined,
  parseTrace,
  parseUsage,
  readFailure,
  type CallContext,
  type Message,
  type TraceStep,
  type Usage,
} from './api'

export const FIRST_BYTE_MS = 12_000
export const IDLE_MS = 30_000
export const OVERALL_MS = 60_000

const UNREACHABLE = 'Could not reach the server. Check your connection and try again.'
export const STALLED = 'The connection stopped answering. What arrived is shown below. Ask again to retry.'
const TOO_SLOW = 'The reply took too long. What arrived is shown below. Ask again to retry.'
const CUT_SHORT = 'The reply stopped before it was finished. What arrived is shown below.'

export interface ChatHandlers {
  onStep: (step: TraceStep) => void
  onDelta: (text: string) => void
  /** The first try got no byte, so the request is being sent once more. */
  onRetry: (reason: string) => void
}

export interface ChatDone {
  text: string
  model?: string
  usage?: Usage
  totalMs?: number
}

type Attempt = { kind: 'done'; done: ChatDone } | { kind: 'retry'; reason: string }

function failedStepNow(detail: string): TraceStep {
  return { name: 'model call', status: 'failed', ms: 0, detail }
}

async function attempt(message: string, history: Message[], handlers: ChatHandlers, signal: AbortSignal | undefined): Promise<Attempt> {
  const request = new AbortController()
  const forward = () => request.abort()
  signal?.addEventListener('abort', forward, { once: true })
  let gotByte = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let overall: ReturnType<typeof setTimeout> | undefined
  let tripped: 'first' | 'idle' | 'overall' | undefined
  let touch = () => {}
  // The watchdog is raced against the whole attempt, so it works even if fetch or the reader ignores the abort.
  const watchdog = new Promise<never>((_resolve, reject) => {
    const trip = (why: 'first' | 'idle' | 'overall') => () => {
      tripped = why
      request.abort()
      reject(new Error(why))
    }
    touch = () => {
      clearTimeout(timer)
      timer = setTimeout(trip(gotByte ? 'idle' : 'first'), gotByte ? IDLE_MS : FIRST_BYTE_MS)
    }
    overall = setTimeout(trip('overall'), OVERALL_MS)
  })
  watchdog.catch(() => undefined)
  touch()

  const run = async (): Promise<Attempt> => {
    const call: CallContext = { stage: 'model call', started: Date.now(), signal }
    let response: Response
    try {
      response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
        signal: request.signal,
      })
    } catch (err) {
      if (signal?.aborted) throw err
      return { kind: 'retry', reason: 'the request did not reach the server' }
    }
    if (!response.ok || !response.body) {
      const failure = await readFailure(response, 'The AI provider', call)
      failure.trace.forEach(handlers.onStep)
      throw new RunError(failure.message, [], failure.totalMs)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const parser = createSseParser()
    let text = ''
    let result: ChatDone | undefined
    let failure: RunError | undefined
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (err) {
        if (signal?.aborted) throw err
        if (!gotByte) return { kind: 'retry', reason: 'the connection dropped before any reply' }
        throw new RunError(UNREACHABLE, [])
      }
      if (chunk.done) break
      gotByte = true
      touch()
      const fed = parser.feed(decoder.decode(chunk.value, { stream: true }))
      for (const payload of fed.data) {
        let event: Record<string, unknown>
        try {
          event = JSON.parse(payload) as Record<string, unknown>
        } catch {
          continue
        }
        if (event.type === 'step') {
          parseTrace([event.step]).forEach(handlers.onStep)
        } else if (event.type === 'delta' && typeof event.text === 'string') {
          text += event.text
          handlers.onDelta(event.text)
        } else if (event.type === 'done') {
          result = {
            text: typeof event.result === 'string' && event.result.trim() ? event.result.trim() : text.trim(),
            model: typeof event.model === 'string' ? event.model : undefined,
            usage: parseUsage(event.usage),
            totalMs: numberOrUndefined(event.totalMs),
          }
        } else if (event.type === 'error') {
          const message = typeof event.error === 'string' && event.error ? event.error : CUT_SHORT
          failure = new RunError(message, [], numberOrUndefined(event.totalMs))
        }
      }
      if (fed.done) {
        await reader.cancel().catch(() => undefined)
        break
      }
    }
    if (failure) throw failure
    if (result) return { kind: 'done', done: result }
    throw new RunError(CUT_SHORT, [])
  }

  try {
    return await Promise.race([run(), watchdog])
  } catch (err) {
    if (signal?.aborted) throw err
    if (tripped === 'first') return { kind: 'retry', reason: `the server sent nothing for ${FIRST_BYTE_MS / 1000} seconds` }
    if (tripped === 'idle') throw new RunError(STALLED, [])
    if (tripped === 'overall') throw new RunError(TOO_SLOW, [])
    throw err
  } finally {
    clearTimeout(timer)
    clearTimeout(overall)
    signal?.removeEventListener('abort', forward)
  }
}

/**
 * Asks the question and hands each step and each piece of the answer to the handlers as it arrives. A first
 * try that gets no byte at all is sent once more, and the caller is told why. A failure throws a RunError whose
 * message is written for the reader; the steps that ran have already gone to onStep. A cancel from the caller
 * rejects with its own abort.
 */
export async function chat(message: string, history: Message[], handlers: ChatHandlers, signal?: AbortSignal): Promise<ChatDone> {
  const first = await attempt(message, history, handlers, signal)
  if (first.kind === 'done') return first.done
  handlers.onRetry(first.reason)
  const second = await attempt(message, history, handlers, signal)
  if (second.kind === 'done') return second.done
  handlers.onStep(failedStepNow(`Gave up after one retry: ${second.reason}`))
  throw new RunError(second.reason.includes('dropped') || second.reason.includes('reach') ? UNREACHABLE : STALLED, [])
}
