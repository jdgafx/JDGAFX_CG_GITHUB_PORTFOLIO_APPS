import { PlainError, plainMessageOf, SERVER_ERROR } from '../errors'
import { cleanRevisedAnswer, sanitizeCitations, sourcesFor } from '../citations'
import type { EndingView, Frame, NodeEndFrame, NodeName, ResultFrame, SourceView, Totals } from '../events'
import { round12 } from '../models'
import { BUDGET_MESSAGE, SLOW_MESSAGE } from '../openrouter'
import { isRecord } from '../json'
import { offersFrom, type HistoryPoint, type Rewind, type Snapshot } from '../checkpoint'
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
  const names = rows.map((row) => row.servedModel).filter((name): name is string => !!name)
  return [...new Set(names)]
}

function frameFor(
  values: ResearchValues,
  ms: number,
  skip: number,
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
    // A resumed run reports only the steps it ran again; the first `skip` rows are the original run's.
    totals: totalsFor(rows.slice(skip), ms),
    models: modelsFor(rows.slice(skip)),
  }
}

function resultFrame(values: ResearchValues, ms: number, skip: number): ResultFrame | null {
  const { finalAnswer, critique } = values
  if (!finalAnswer || !critique) return null
  const { answer, sources, truncated, ending } = finalAnswer
  return frameFor(values, ms, skip, answer, sources, { verdict: critique.verdict, notes: critique.notes, reviewed: critique.reviewed }, truncated, ending)
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
export function partialResult(values: ResearchValues, ms: number, message: string, skip = 0): ResultFrame | null {
  const cause = causeOf(message)
  if (values.draftText !== '') {
    const draft = values.revisions > 0 ? cleanRevisedAnswer(values.draftText, values.evidence, values.question).text : values.draftText
    const answer = sanitizeCitations(draft, values.evidence)
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
    return frameFor(values, ms, skip, answer, sources, critic, values.draftTruncated, { kind: 'partial', message: text })
  }
  if (values.evidence.length === 0) return null
  const pages = values.evidence.map(({ n, title, url }) => ({ n, title, url }))
  const text = `No answer was written: ${cause} the run. The agent read ${values.evidence.length === 1 ? '1 page' : `${values.evidence.length} pages`}, listed below.`
  return frameFor(values, ms, skip, '', pages, { verdict: 'accept', notes: text, reviewed: false }, false, { kind: 'no_answer', message: text })
}

interface Drive {
  /** The graph input: the question for a fresh run, null to continue from a saved state. */
  input: { question: string } | null
  /** Rows of the trace that came before this run's own work. */
  skip: number
  /** Added to the result of a resumed run. */
  fork?: ResultFrame['fork']
}

/** The saved states of a finished thread, newest first, as the checkpointer holds them. */
async function historyOf(graph: ReturnType<typeof buildGraph>, config: { configurable: { thread_id: string } }): Promise<HistoryPoint[]> {
  const points: HistoryPoint[] = []
  for await (const state of graph.getStateHistory(config)) {
    points.push({ next: state.next, values: state.values as ResearchValues })
  }
  return points
}

/**
 * Streams the graph from `input` and emits frames as it moves. It never throws: a failure becomes one error
 * frame, after the failed node's end frame, or a partial result when work was already done.
 */
async function drive(
  graph: ReturnType<typeof buildGraph>,
  threadConfig: { configurable: { thread_id: string } },
  deps: GraphDeps,
  emit: (frame: Frame) => void,
  { input, skip, fork }: Drive,
): Promise<void> {
  const started = Date.now()
  const tracker: Tracker = { open: null, failure: null }
  try {
    const stream = await graph.stream(input, {
      ...threadConfig,
      signal: deps.signal,
      recursionLimit: GRAPH_RECURSION_LIMIT,
      streamMode: ['updates', 'custom'],
    })
    for await (const [mode, chunk] of stream as unknown as AsyncIterable<[string, unknown]>) {
      if (mode === 'custom') {
        handleCustom(chunk, emit, tracker)
      } else if (mode === 'updates') {
        handleUpdate(chunk, emit, tracker)
      }
    }
    const snapshot = await graph.getState(threadConfig)
    const result = resultFrame(snapshot.values as ResearchValues, Date.now() - started, skip)
    if (!result) throw new PlainError(500, SERVER_ERROR)
    emit(fork ? { ...result, fork: { ...fork, rerun: result.path.length - skip } } : result)
    if (!fork && deps.secret) {
      const items = offersFrom(await historyOf(graph, threadConfig), deps.secret, Date.now())
      if (items.length > 0) emit({ type: 'checkpoints', items })
    }
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
    const partial = snapshot ? partialResult(snapshot.values as ResearchValues, Date.now() - started, message, skip) : null
    emit(partial ? (fork ? { ...partial, fork: { ...fork, rerun: partial.path.length - skip } } : partial) : { type: 'error', message })
  }
}

/** Runs one research question. */
export async function runResearch(question: string, deps: GraphDeps, emit: (frame: Frame) => void): Promise<void> {
  const graph = buildGraph(deps)
  const threadConfig = { configurable: { thread_id: crypto.randomUUID() } }
  await drive(graph, threadConfig, deps, emit, { input: { question }, skip: 0 })
}

/**
 * Continues from a saved point. The checked edit is written into a fresh thread as the output of the node it
 * replaces, and the graph runs on from there: the steps before the point are not run again, and their rows are
 * sent first, marked reused. The run has its own budget and the same time-aware steps.
 */
export async function resumeResearch(
  snapshot: Snapshot,
  rewind: Rewind,
  deps: GraphDeps,
  emit: (frame: Frame) => void,
): Promise<void> {
  const { values, asNode, reusedRows } = rewind
  const graph = buildGraph(deps)
  const threadConfig = { configurable: { thread_id: crypto.randomUUID() } }
  await graph.updateState(threadConfig, values, asNode)
  const rows = values.trace ?? []
  rows.forEach((row, i) => emit({ ...nodeEnd(row), reused: i < reusedRows, edited: row.edited }))
  await drive(graph, threadConfig, deps, emit, {
    input: null,
    skip: rows.length,
    fork: { kind: snapshot.kind, visit: snapshot.visit, reused: reusedRows, rerun: 0 },
  })
}
