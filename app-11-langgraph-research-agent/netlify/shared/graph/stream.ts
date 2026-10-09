import { PlainError, plainMessageOf, SERVER_ERROR } from '../errors'
import type { Frame, NodeEndFrame, NodeName, ResultFrame, Totals } from '../events'
import { round12 } from '../models'
import { SLOW_MESSAGE } from '../openrouter'
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

/** Maps one custom chunk to a frame. Returns the failure text when a node failed. */
function handleCustom(raw: unknown, emit: (frame: Frame) => void): string | null {
  if (!isRecord(raw)) return null
  const chunk = raw as unknown as CustomChunk
  if (chunk.kind === 'start') {
    emit({ type: 'node_start', node: chunk.node, visit: chunk.visit, ms: chunk.ms })
    return null
  }
  if (chunk.kind === 'failed') {
    emit(nodeEnd(chunk.row))
    return chunk.row.detail
  }
  return null
}

/** Maps one updates chunk, `{ [node]: delta }`, to node_end and edge frames. */
function handleUpdate(raw: unknown, emit: (frame: Frame) => void): void {
  if (!isRecord(raw)) return
  for (const [node, delta] of Object.entries(raw)) {
    if (!isRecord(delta)) continue
    const rows: TraceRow[] = Array.isArray(delta.trace) ? (delta.trace as TraceRow[]) : []
    for (const row of rows) emit(nodeEnd(row))
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

function resultFrame(values: ResearchValues, ms: number): ResultFrame | null {
  if (!values.finalAnswer || !values.critique) return null
  const rows = values.trace
  return {
    type: 'result',
    answer: values.finalAnswer.answer,
    sources: values.finalAnswer.sources,
    critic: { verdict: values.critique.verdict, notes: values.critique.notes, reviewed: values.critique.reviewed },
    path: rows.map((row) => row.node),
    evidenceCount: values.evidence.length,
    toolRounds: values.toolRounds,
    revisions: values.revisions,
    truncated: values.finalAnswer.truncated,
    totals: totalsFor(rows, ms),
    models: modelsFor(rows),
  }
}

/**
 * Runs one research question and emits frames as the graph moves. It never throws: a
 * failure becomes one error frame, after the failed node's end frame.
 */
export async function runResearch(question: string, deps: GraphDeps, emit: (frame: Frame) => void): Promise<void> {
  const graph = buildGraph(deps)
  const threadConfig = { configurable: { thread_id: crypto.randomUUID() } }
  const started = Date.now()
  let failure: string | null = null
  try {
    const stream = await graph.stream(
      { question },
      { ...threadConfig, signal: deps.signal, recursionLimit: GRAPH_RECURSION_LIMIT, streamMode: ['updates', 'custom'] },
    )
    for await (const [mode, chunk] of stream as unknown as AsyncIterable<[string, unknown]>) {
      if (mode === 'custom') {
        failure = handleCustom(chunk, emit) ?? failure
      } else if (mode === 'updates') {
        handleUpdate(chunk, emit)
      }
    }
    const snapshot = await graph.getState(threadConfig)
    const result = resultFrame(snapshot.values as ResearchValues, Date.now() - started)
    if (!result) throw new PlainError(500, SERVER_ERROR)
    emit(result)
  } catch (err) {
    // A wrapped provider error still yields its plain message. Anything else gets the generic text.
    const message = failure ?? plainMessageOf(err) ?? (deps.signal.aborted ? SLOW_MESSAGE : SERVER_ERROR)
    emit({ type: 'error', message })
  }
}
