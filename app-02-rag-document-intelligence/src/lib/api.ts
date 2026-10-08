import { TOP_K } from './constants'
import type { RunReport, TraceStep, Usage } from '../types'

/** 'passage' or 'passages', by count. */
function noun(count: number): string {
  return count === 1 ? 'passage' : 'passages'
}


/**
 * Words carried by almost every question and almost every passage. Left in the
 * term set they swamp the signal, so a question about "revenue" would rank on
 * "what" and "the" instead.
 */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her', 'was', 'one',
  'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old',
  'see', 'two', 'who', 'did', 'yes', 'she', 'they', 'them', 'this', 'that', 'these', 'those',
  'with', 'from', 'have', 'been', 'were', 'what', 'when', 'where', 'which', 'while', 'does',
  'doing', 'about', 'into', 'over', 'than', 'then', 'there', 'their', 'would', 'could',
  'should', 'will', 'your', 'yours', 'been', 'being', 'here', 'more', 'most', 'some', 'such',
  'only', 'very', 'much', 'many', 'each', 'other', 'also', 'just', 'like', 'tell', 'say',
  'says', 'said', 'give', 'please', 'document', 'documents', 'text', 'file', 'page', 'pages',
])

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/\b[a-z0-9]{3,}\b/g) ?? []
}

/** Distinct content words from the question, falling back to raw tokens if the
 * question is nothing but stop words ("what is this about?"). */
export function questionTerms(question: string): Set<string> {
  const all = tokenize(question)
  const meaningful = all.filter(w => !STOP_WORDS.has(w))
  return new Set(meaningful.length > 0 ? meaningful : all)
}

/**
 * Rank by how much of the question a passage actually covers -- the share of
 * distinct question terms it contains. Scoring by hit *rate* instead (hits per
 * word) let a five-word fragment mentioning one term outrank a paragraph that
 * answered the whole question.
 *
 * A sub-step density bonus breaks ties between equal-coverage passages. It is
 * scaled below one coverage step, so more distinct matches always wins.
 */
export function scoreChunk(chunk: string, qSet: Set<string>): number {
  if (qSet.size === 0) return 0
  const words = tokenize(chunk)
  if (words.length === 0) return 0

  const matched = new Set<string>()
  let hits = 0
  for (const word of words) {
    if (qSet.has(word)) {
      matched.add(word)
      hits++
    }
  }
  if (matched.size === 0) return 0

  const coverage = matched.size / qSet.size
  const density = hits / Math.sqrt(words.length)
  const step = 1 / qSet.size
  return coverage + 0.4 * step * Math.min(density, 1)
}

interface RetrievedChunk {
  chunk: string
  index: number
  score: number
}

/** Top-scoring passages, returned in document order so the model reads them
 * the way the author wrote them. */
export function retrieve(question: string, chunks: string[], limit: number = TOP_K): RetrievedChunk[] {
  const qSet = questionTerms(question)
  const scored = chunks
    .map((chunk, index) => ({ chunk, index, score: scoreChunk(chunk, qSet) }))
    .filter(c => c.score > 0)

  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, limit).sort((a, b) => a.index - b.index)
}

// The step names the server records. Kept in step with netlify/shared/answer.ts.
const RETRIEVE_STEP = 'Retrieve passages'
const SERVER_STEPS = ['Accept request', 'Build prompt', 'Call model', 'Parse and validate']

type AskOutcome =
  | { status: 'answered'; answer: string; sourceChunks: number[]; selfRated: number; run: RunReport }
  | { status: 'no-matches'; run: RunReport }

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
  onRetrieved: (indices: number[]) => void
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
async function readStream(body: ReadableStream<Uint8Array>, events: AskEvents): Promise<StreamEnd | null> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let end: StreamEnd | null = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
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
  const top = retrieve(question, chunks)
  events.onRetrieved(top.map(t => t.index))
  const retrieval: TraceStep = {
    name: RETRIEVE_STEP,
    status: 'ok',
    ms: Math.round(performance.now() - began),
    detail: top.length > 0
      ? `Kept ${top.length} of ${chunks.length} ${noun(chunks.length)} by term overlap.`
      : `None of the ${chunks.length} ${noun(chunks.length)} shares a word with the question.`,
  }
  events.onStep(retrieval)

  if (top.length === 0) {
    const skipped = SERVER_STEPS.map(name => skippedStep(name, 'Not run. No passage matched, so the model was not called.'))
    for (const step of skipped) events.onStep(step)
    return { status: 'no-matches', run: runWith([retrieval, ...skipped], retrieval.ms) }
  }

  const labeledChunks = top.map(t => `[Chunk ${t.index}]:\n${t.chunk}`)

  let response: Response
  try {
    response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ question, chunks: labeledChunks, documentTitle }),
      signal,
    })
  } catch (err) {
    if (signal?.aborted) throw err
    console.error('DocMind request failed:', err)
    throw new AskError(
      'Could not reach the server. Check your connection and try again.',
      runWith([retrieval, failedStep('Call model', 'Could not reach the server.')], null),
    )
  }

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
    throw new AskError(message, runWith([retrieval, ...failure], totalMs))
  }

  let run: ServerRun
  if (response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
    let end: StreamEnd | null
    try {
      end = await readStream(response.body, events)
    } catch (err) {
      if (signal?.aborted) throw err
      console.error('DocMind response was not readable:', err)
      throw new AskError(
        'The document assistant returned an unreadable response. Please try again.',
        runWith([retrieval, failedStep('Parse and validate', 'The response could not be read.')], null),
      )
    }
    if (end?.kind === 'error') {
      throw new AskError(end.message, runWith([retrieval, ...end.trace], end.totalMs))
    }
    if (end?.kind !== 'result') {
      throw new AskError(
        'The document assistant returned an unexpected response. Please try again.',
        runWith([retrieval, failedStep('Parse and validate', 'The response ended before an answer.')], null),
      )
    }
    run = end.run
  } else {
    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new AskError(
        'The document assistant returned an unreadable response. Please try again.',
        runWith([retrieval, failedStep('Parse and validate', 'The response was not JSON.')], null),
      )
    }
    if (!isServerRun(data)) {
      throw new AskError(
        'The document assistant returned an unexpected response. Please try again.',
        runWith([retrieval, failedStep('Parse and validate', 'The response had an unexpected shape.')], null),
      )
    }
    run = data
  }

  // The server keeps only citations that name a passage it was sent, so they are used as they are.
  return {
    status: 'answered',
    answer: run.result.answer,
    sourceChunks: run.result.source_chunk_indices,
    selfRated: Math.min(1, Math.max(0, run.result.confidence)),
    run: { trace: [retrieval, ...run.trace], usage: run.usage, model: run.model, totalMs: run.totalMs },
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
