import { PlainError, plainMessageOf, SERVER_ERROR } from '../errors'
import { sanitizeCitations, sourcesFor } from '../citations'
import type { EndingView, Frame, NodeEndFrame, NodeName, ResultFrame, SourceView, Totals } from '../events'
import { round12 } from '../models'
import { BUDGET_MESSAGE, SLOW_MESSAGE } from '../openrouter'
import { isRecord } from '../json'
import { buildGraph, type CustomChunk, type GraphDeps } from './build'
import type { ResearchValues, TraceRow } from './state'

export const GRAPH_RECURSION_LIMIT = 30

function nodeEnd(row: TraceRow): NodeEndFrame {
  const { node, visit, ms, status, detail, model, servedModel, cost, costSource, usage } = row
  // JSON drops the undefined fields, so a row without a model call sends none of them.
  return {
    type: 'node_end',
    node,
    visit,
    ms,
    status,
    detail,
    model,
    servedModel,
    cost,
    costSource,
    usage: usage && {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
    },
  }
}

/** The visit that has started and not yet ended, so a stop in the middle of it can still be reported. */
interface OpenVisit {
  node: NodeName
  visit: number
  startedAt: number
}

interface Tracker {
  open: OpenVisit | null
  failure: string | null
}

/** Maps one custom chunk to a frame. A failed node's text is kept on the tracker. */
function handleCustom(raw: unknown, emit: (frame: Frame) => void, tracker: Tracker): void {
  if (!isRecord(raw)) return
  const chunk = raw as unknown as CustomChunk
  if (chunk.kind === 'start') {
    tracker.open = { node: chunk.node, visit: chunk.visit, startedAt: Date.now() }
    emit({ type: 'node_start', node: chunk.node, visit: chunk.visit, ms: chunk.ms })
  } else if (chunk.kind === 'failed') {
    tracker.open = null
    emit(nodeEnd(chunk.row))
    tracker.failure = chunk.row.detail
  }
}

/** Maps one updates chunk, `{ [node]: delta }`, to node_end and edge frames. */
function handleUpdate(raw: unknown, emit: (frame: Frame) => void, tracker: Tracker): void {
  if (!isRecord(raw)) return
  for (const [node, delta] of Object.entries(raw)) {
    if (!isRecord(delta)) continue
    const rows: TraceRow[] = Array.isArray(delta.trace) ? (delta.trace as TraceRow[]) : []
    for (const row of rows) emit(nodeEnd(row))
    if (rows.length > 0) tracker.open = null
    const route = delta.route
    if (isRecord(route) && typeof route.to === 'string' && typeof route.label === 'string') {
      emit({ type: 'edge', from: node as NodeName, to: route.to as NodeName, label: route.label })
    }
  }
}

function totalsFor(rows: TraceRow[], ms: number): Totals {
  // A row with a model made a model call, and only those can lack a price. Tool and final rows
  // never carry a model, so they are not counted.
  const unpricedRows = rows.filter((row) => row.model !== undefined && row.cost === undefined).length
  const totals: Totals = { ms, unpricedRows }
  const tokenRows = rows.filter((row) => row.usage?.total_tokens !== undefined)
  if (tokenRows.length > 0) {
    totals.tokens = tokenRows.reduce((sum, row) => sum + (row.usage?.total_tokens ?? 0), 0)
  }
  const priced = rows.filter((row) => row.cost !== undefined)
  if (priced.length > 0) {
    totals.cost = round12(priced.reduce((sum, row) => sum + (row.cost ?? 0), 0))
    totals.costSource = priced.some((row) => row.costSource === 'estimated') ? 'estimated' : 'usage'
  }
  return totals
}

function modelsFor(rows: TraceRow[]): string[] {
  const names = rows.map((row) => row.servedModel ?? row.model).filter((name): name is string => !!name)
  return [...new Set(names)]
}

function frameFor(
  values: ResearchValues,
  ms: number,
  answer: string,
  sources: SourceView[],
  critic: ResultFrame['critic'],
  truncated: boolean,
  ending: EndingView,
): ResultFrame {
  const rows = values.trace
  return {
    type: 'result',
    answer,
    sources,
    critic,
    ending,
    path: rows.map((row) => row.node),
    evidenceCount: values.evidence.length,
    toolRounds: values.toolRounds,
    revisions: values.revisions,
    truncated,
    totals: totalsFor(rows, ms),
    models: modelsFor(rows),
  }
}

function resultFrame(values: ResearchValues, ms: number): ResultFrame | null {
  const { finalAnswer, critique } = values
  if (!finalAnswer || !critique) return null
  const { answer, sources, truncated, ending } = finalAnswer
  return frameFor(values, ms, answer, sources, { verdict: critique.verdict, notes: critique.notes, reviewed: critique.reviewed }, truncated, ending)
}

const times = (count: number) => (count === 1 ? 'once' : `${count} times`)

/** What stopped the run, in words that fit the sentence "...ended the review". */
function causeOf(message: string): string {
  if (message === BUDGET_MESSAGE) return 'the time limit ended'
  if (message === SLOW_MESSAGE) return 'a provider timeout ended'
  return 'a failed step ended'
}

/**
 * Builds the result a stopped run still owes the visitor: the last draft with its cited sources and a
 * plain label of how far the review got, or, with no draft, the pages read. Null when nothing was found.
 */
export function partialResult(values: ResearchValues, ms: number, message: string): ResultFrame | null {
  const cause = causeOf(message)
  if (values.draftText !== '') {
    const answer = sanitizeCitations(values.draftText, values.evidence)
    const sources = sourcesFor(answer, values.evidence)
    const reviewed = values.draftReviewed && values.critique !== null
    const text = !reviewed
      ? values.revisions === 0
        ? `Unreviewed: ${cause} the review.`
        : `Revised ${times(values.revisions)}, then ${cause} the last review. This draft was not reviewed.`
      : `Reviewed ${times(values.revisions)}: the critic asked for changes, but ${cause} the revision. This is the reviewed draft.`
    const critic =
      reviewed && values.critique
        ? { verdict: values.critique.verdict, notes: values.critique.notes, reviewed: true }
        : { verdict: 'accept' as const, notes: text, reviewed: false }
    return frameFor(values, ms, answer, sources, critic, values.draftTruncated, { kind: 'partial', message: text })
  }
  if (values.evidence.length === 0) return null
  const pages = values.evidence.map(({ n, title, url }) => ({ n, title, url }))
  const text = `No answer was written: ${cause} the run. The agent read ${values.evidence.length === 1 ? '1 page' : `${values.evidence.length} pages`}, listed below.`
  return frameFor(values, ms, '', pages, { verdict: 'accept', notes: text, reviewed: false }, false, { kind: 'no_answer', message: text })
}

/**
 * Runs one research question and emits frames as the graph moves. It never throws: a
 * failure becomes one error frame, after the failed node's end frame.
 */
export async function runResearch(question: string, deps: GraphDeps, emit: (frame: Frame) => void): Promise<void> {
  const graph = buildGraph(deps)
  const threadConfig = { configurable: { thread_id: crypto.randomUUID() } }
  const started = Date.now()
  const tracker: Tracker = { open: null, failure: null }
  try {
    const stream = await graph.stream(
      { question },
      { ...threadConfig, signal: deps.signal, recursionLimit: GRAPH_RECURSION_LIMIT, streamMode: ['updates', 'custom'] },
    )
    for await (const [mode, chunk] of stream as unknown as AsyncIterable<[string, unknown]>) {
      if (mode === 'custom') {
        handleCustom(chunk, emit, tracker)
      } else if (mode === 'updates') {
        handleUpdate(chunk, emit, tracker)
      }
    }
    const snapshot = await graph.getState(threadConfig)
    const result = resultFrame(snapshot.values as ResearchValues, Date.now() - started)
    if (!result) throw new PlainError(500, SERVER_ERROR)
    emit(result)
  } catch (err) {
    // A wrapped provider error still yields its plain message. Anything else gets the generic text.
    const message = tracker.failure ?? plainMessageOf(err) ?? (deps.signal.aborted ? BUDGET_MESSAGE : SERVER_ERROR)
    // An abort ends the stream before the failed node can report itself, so its row is closed here.
    if (tracker.open && tracker.failure === null) {
      const { node, visit, startedAt } = tracker.open
      emit(nodeEnd({ node, visit, status: 'failed', ms: Date.now() - startedAt, detail: message }))
    }
    // Work already done is never thrown away: the last committed state still holds the draft and the pages read.
    const snapshot = await graph.getState(threadConfig).catch(() => null)
    const partial = snapshot ? partialResult(snapshot.values as ResearchValues, Date.now() - started, message) : null
    emit(partial ?? { type: 'error', message })
  }
}
