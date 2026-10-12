import { END, MemorySaver, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph'
import { PlainError, plainMessageOf, SERVER_ERROR, spentOf } from '../errors'
import type { NodeName } from '../events'
import type { ChatFn } from '../openrouter'
import { costFor, newestModel, type PriceBook } from '../pricing'
import type { WikiTools } from '../wikipedia'
import {
  agentStep,
  criticStep,
  draftStep,
  finalStep,
  planStep,
  toolsStep,
  type NodeCall,
  type NodeContext,
  type NodeResult,
} from './nodes'
import { ResearchState, type ResearchValues, type Target, type TraceRow } from './state'

export interface GraphDeps {
  chat: ChatFn
  wiki: WikiTools
  /** One signal for the whole run. Aborting it ends the run's in-flight call. */
  signal: AbortSignal
  /** When the run budget ends, as a Date.now() value. The steps skip work that no longer fits. */
  deadline?: number
  /** The clock the steps read. Tests replace it. */
  now?: () => number
  /** Signs the checkpoints a finished run offers. Without it a run offers none. */
  secret?: string
  /**
   * OpenRouter's price list, already being fetched when the run starts. A step waits for it only when it
   * prices a model call. Without it, or when it resolves to null, no call has a price.
   */
  priceBook?: Promise<PriceBook | null>
}

/** Written to the custom stream while a node runs. */
export interface StartChunk {
  kind: 'start'
  node: NodeName
  visit: number
  /** Offset from the start of the run. */
  ms: number
}

/** Written to the custom stream when a node fails, just before the error propagates. */
export interface FailedChunk {
  kind: 'failed'
  row: TraceRow
}

export type CustomChunk = StartChunk | FailedChunk

/** Puts the billed call on a row: the model, its usage and its price. A call that never reported is only counted. */
async function addCall(row: TraceRow, call: NodeCall | null, unreported: number, priceBook: Promise<PriceBook | null>): Promise<void> {
  if (unreported > 0) row.unreportedCalls = unreported
  if (!call) return
  const { model, reply } = call
  row.model = model
  row.servedModel = reply.servedModel
  row.usage = reply.usage
  // The price is the list price of the model that answered, never of the one asked for.
  if (call.refused) {
    // A refused reply is billed, so its cost is what OpenRouter reported for the call. The list price is the fallback.
    row.refused = true
    if (reply.usage.cost !== undefined) {
      row.cost = reply.usage.cost
      row.costSource = 'reported'
      return
    }
    row.costSource = 'list'
  }
  const cost = costFor(await priceBook.catch(() => null), reply.servedModel, reply.usage)
  if (cost !== null) row.cost = cost
}

async function rowFor(node: NodeName, visit: number, ms: number, result: NodeResult, priceBook: Promise<PriceBook | null>): Promise<TraceRow> {
  const retry = result.call?.retried ? ' The first call timed out or could not connect, so it was tried once more.' : ''
  const unchecked = result.call && !result.call.checked ? ' The served model was not checked: the price list was unavailable.' : ''
  const detail = `${result.detail}${retry}${unchecked}`
  const row: TraceRow = { node, visit, status: result.status ?? 'ok', ms, detail }
  if (result.route) row.next = result.route.label
  await addCall(row, result.call ?? null, result.call?.unreported ?? 0, priceBook)
  return row
}

/** The row of a node that threw. A call it made before it failed is on the error, and counts here like any other. */
async function failedRow(node: NodeName, visit: number, ms: number, err: unknown, priceBook: Promise<PriceBook | null>): Promise<TraceRow> {
  const row: TraceRow = { node, visit, status: 'failed', ms, detail: plainMessageOf(err) ?? SERVER_ERROR }
  const spent = spentOf(err)
  if (spent) await addCall(row, spent.call, spent.unreported, priceBook)
  return row
}

function routeAfter(state: ResearchValues): Target {
  if (!state.route) throw new PlainError(500, SERVER_ERROR)
  return state.route.to
}

/**
 * Wires the graph. Each node is wrapped so it reports its start, its trace row and its
 * route, and the wrapper tells the stream when a node fails. A new graph is built for each
 * run, so its memory checkpointer holds that run only.
 */
export function buildGraph(deps: GraphDeps) {
  const origin = Date.now()
  const priceBook = deps.priceBook ?? Promise.resolve(null)
  const newest = priceBook.then(newestModel)

  const wrap =
    (name: NodeName, run: (state: ResearchValues, ctx: NodeContext) => NodeResult | Promise<NodeResult>) =>
    async (state: ResearchValues, config: LangGraphRunnableConfig): Promise<Partial<ResearchValues>> => {
      const write = config.writer ?? (() => undefined)
      const visit = state.trace.filter((row) => row.node === name).length + 1
      write({ kind: 'start', node: name, visit, ms: Date.now() - origin } satisfies StartChunk)
      const began = Date.now()
      try {
        const result = await run(state, { ...deps, newestModel: newest })
        const row = await rowFor(name, visit, Date.now() - began, result, priceBook)
        return { ...result.update, route: result.route ?? null, trace: [row] }
      } catch (err) {
        write({ kind: 'failed', row: await failedRow(name, visit, Date.now() - began, err, priceBook) } satisfies FailedChunk)
        throw err
      }
    }

  return new StateGraph(ResearchState)
    .addNode('plan', wrap('plan', planStep))
    .addNode('agent', wrap('agent', agentStep))
    .addNode('tools', wrap('tools', toolsStep))
    .addNode('draft', wrap('draft', draftStep))
    .addNode('critic', wrap('critic', criticStep))
    .addNode('final', wrap('final', finalStep))
    .addEdge(START, 'plan')
    .addEdge('plan', 'agent')
    .addConditionalEdges('agent', routeAfter, ['tools', 'draft'])
    .addEdge('tools', 'agent')
    .addEdge('draft', 'critic')
    .addConditionalEdges('critic', routeAfter, ['draft', 'final'])
    .addEdge('final', END)
    .compile({ checkpointer: new MemorySaver() })
}
