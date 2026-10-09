import { retrieve, type Retrieval } from './bm25'
import { noun } from './passageMap'
import { startWatchdog, type WatchdogReason } from './watchdog'
import type { RunReport, TraceStep, Usage } from '../types'

// The step names the server records.
const RETRIEVE_STEP = 'Retrieve passages'
const SERVER_STEPS = ['Accept request', 'Build prompt', 'Call model', 'Parse and validate']

/** No byte for this long means the stream has stalled. */
export const STALL_MS = 30_000
/** The server's budget is 25 s; the browser waits much longer than that before it gives up. */
export const CAP_MS = 90_000

type AskOutcome =
  | { status: 'answered'; answer: string; sourceChunks: number[]; selfRated: number; run: RunReport; retrieval: Retrieval }
  | { status: 'no-matches'; run: RunReport; retrieval: Retrieval }

/** A question that got no answer. `run` holds every step that ran, including the one that failed. */
export class AskError extends Error {
  readonly run: RunReport

  constructor(message: string, run: RunReport) {
    super(message)
    this.name = 'AskError'
    this.run = run
  }
}

/** Progress callbacks, so the page can show each step as it happens. */
interface AskEvents {
  onStart: (name: string) => void
  onStep: (step: TraceStep) => void
  /** Indices of the passages ranked for this question, before the server is called. */
  onRetrieved: (retrieval: Retrieval) => void
}

interface ServerRun {
  result: { answer: string; source_chunk_indices: number[]; confidence: number }
  trace: TraceStep[]
  usage: Usage
  model: string | null
  totalMs: number
}

type StreamEnd =
  | { kind: 'result'; run: ServerRun }
  | { kind: 'error'; message: string; trace: TraceStep[]; totalMs: number | null }

function fallbackMessage(status: number): string {
  if (status === 429) return 'Rate limited, try again in a minute.'
  if (status === 413) return 'That document section was too large to send. Try a narrower question.'
  if (status === 504) return 'The AI provider did not answer in time.'
  if (status >= 500) return 'The document assistant is temporarily unavailable. Please try again.'
  return 'The document assistant could not answer that question. Please try again.'
}

function runWith(trace: TraceStep[], totalMs: number | null): RunReport {
  return { trace, usage: null, model: null, totalMs }
}

function failedStep(name: string, detail: string): TraceStep {
  return { name, status: 'failed', ms: null, detail }
}

function skippedStep(name: string, detail: string): TraceStep {
  return { name, status: 'skipped', ms: null, detail }
}

function isStep(value: unknown): value is TraceStep {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v['name'] === 'string' && typeof v['status'] === 'string' && typeof v['detail'] === 'string'
}

function isServerRun(data: unknown): data is ServerRun {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  const result = d['result']
  const usage = d['usage']
  if (typeof result !== 'object' || result === null || typeof usage !== 'object' || usage === null) return false
  const r = result as Record<string, unknown>
  return (
    typeof r['answer'] === 'string' &&
    Array.isArray(r['source_chunk_indices']) &&
    typeof r['confidence'] === 'number' &&
    Array.isArray(d['trace']) &&
    typeof d['totalMs'] === 'number'
  )
}

/** Reads the event stream frame by frame. Ends on the first result or error frame. */
async function readStream(body: ReadableStream<Uint8Array>, events: AskEvents, onBytes: () => void): Promise<StreamEnd | null> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let end: StreamEnd | null = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    onBytes()
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find(item => item.startsWith('data: '))
      if (!line) continue
      const raw = line.slice(6)
      if (raw === '[DONE]') continue
      const { type, name, step, run, error, trace, totalMs } = JSON.parse(raw) as Record<string, unknown>
      if (type === 'start' && typeof name === 'string') {
        events.onStart(name)
      } else if (type === 'step' && isStep(step)) {
        events.onStep(step)
      } else if (type === 'result' && isServerRun(run)) {
        end = { kind: 'result', run }
      } else if (type === 'error' && typeof error === 'string') {
        end = {
          kind: 'error',
          message: error,
          trace: Array.isArray(trace) ? trace.filter(isStep) : [],
          totalMs: typeof totalMs === 'number' ? totalMs : null,
        }
      } else {
        throw new Error('Unexpected stream frame')
      }
    }
  }
  return end
}

/**
 * Ranks the passages in the browser, then asks the server to answer from them.
 * The browser times its own retrieval step. The server times the steps it runs.
 */
export async function askQuestion(
  question: string,
  chunks: string[],
  documentTitle: string,
  signal: AbortSignal | undefined,
  events: AskEvents,
): Promise<AskOutcome> {
  const began = performance.now()
  const retrieval = retrieve(question, chunks)
  events.onRetrieved(retrieval)
  const { ranked } = retrieval
  const retrievalStep: TraceStep = {
    name: RETRIEVE_STEP,
    status: 'ok',
    ms: Math.round(performance.now() - began),
    detail: ranked.length > 0
      ? `Scored ${chunks.length} ${noun(chunks.length)} with BM25. ${retrieval.matching} matched; the top ${ranked.length} go to the model.`
      : `None of the ${chunks.length} ${noun(chunks.length)} shares a word with the question.`,
  }
  events.onStep(retrievalStep)

  if (ranked.length === 0) {
    const skipped = SERVER_STEPS.map(name => skippedStep(name, 'Not run. No passage matched, so the model was not called.'))
    for (const step of skipped) events.onStep(step)
    return { status: 'no-matches', run: runWith([retrievalStep, ...skipped], retrievalStep.ms), retrieval }
  }

  // The model reads the passages in the order the author wrote them.
  const labeledChunks = [...ranked].sort((a, b) => a.index - b.index).map(r => `[Chunk ${r.index}]:\n${chunks[r.index] ?? ''}`)

  const stop = new AbortController()
  let stalled: WatchdogReason | null = null
  const dog = startWatchdog(STALL_MS, CAP_MS, reason => {
    stalled = reason
    stop.abort()
  })
  const guard = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal
  const stallError = (): AskError => {
    const idle = stalled === 'idle'
    return new AskError(
      idle ? 'The answer stopped arriving. Ask again, or try a narrower question.' : 'The answer took longer than expected. Ask again in a moment.',
      runWith(
        [retrievalStep, failedStep('Call model', idle ? `No data arrived for ${STALL_MS / 1000} seconds.` : `No answer after ${CAP_MS / 1000} seconds.`)],
        null,
      ),
    )
  }

  try {
    let response: Response
    try {
      response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ question, chunks: labeledChunks, documentTitle }),
        signal: guard,
      })
    } catch (err) {
      if (signal?.aborted) throw err
      if (stalled) throw stallError()
      console.error('DocMind request failed:', err)
      throw new AskError(
        'Could not reach the server. Check your connection and try again.',
        runWith([retrievalStep, failedStep('Call model', 'Could not reach the server.')], null),
      )
    }
    dog.kick()

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error(`DocMind API error ${response.status}:`, text || '(empty response body)')
      const fields: Record<string, unknown> = parseBody(text) ?? {}
      const { error: bodyError, trace: bodyTrace, totalMs: bodyTotalMs } = fields
      const message = typeof bodyError === 'string' && bodyError.trim() !== '' ? bodyError : fallbackMessage(response.status)
      const serverTrace = Array.isArray(bodyTrace) ? bodyTrace.filter(isStep) : []
      // A rejected request never reached a model step, so a 4xx marks the first step.
      const failure = serverTrace.length > 0
        ? serverTrace
        : [failedStep(response.status >= 500 ? 'Call model' : 'Accept request', message)]
      const totalMs = typeof bodyTotalMs === 'number' ? bodyTotalMs : null
      throw new AskError(message, runWith([retrievalStep, ...failure], totalMs))
    }

    if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
      throw new AskError(
        'The document assistant returned an unexpected response. Please try again.',
        runWith([retrievalStep, failedStep('Parse and validate', 'The response was not an event stream.')], null),
      )
    }
    let end: StreamEnd | null
    try {
      end = await readStream(response.body, events, dog.kick)
    } catch (err) {
      if (signal?.aborted) throw err
      if (stalled) throw stallError()
      console.error('DocMind response was not readable:', err)
      throw new AskError(
        'The document assistant returned an unreadable response. Please try again.',
        runWith([retrievalStep, failedStep('Parse and validate', 'The response could not be read.')], null),
      )
    }
    if (end?.kind === 'error') {
      throw new AskError(end.message, runWith([retrievalStep, ...end.trace], end.totalMs))
    }
    if (end?.kind !== 'result') {
      throw new AskError(
        'The document assistant returned an unexpected response. Please try again.',
        runWith([retrievalStep, failedStep('Parse and validate', 'The response ended before an answer.')], null),
      )
    }
    const run = end.run

    // The server keeps only citations that name a passage it was sent, so they are used as they are.
    return {
      status: 'answered',
      answer: run.result.answer,
      sourceChunks: run.result.source_chunk_indices,
      selfRated: Math.min(1, Math.max(0, run.result.confidence)),
      run: { trace: [retrievalStep, ...run.trace], usage: run.usage, model: run.model, totalMs: run.totalMs },
      retrieval,
    }
  } finally {
    dog.stop()
  }
}

function parseBody(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
