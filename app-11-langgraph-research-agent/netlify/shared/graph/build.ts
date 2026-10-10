import { END, MemorySaver, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph'
import { costFor } from '../models'
import { PlainError, plainMessageOf, SERVER_ERROR } from '../errors'
import type { NodeName } from '../events'
import type { ChatFn } from '../openrouter'
import type { WikiTools } from '../wikipedia'
import {
  agentStep,
  criticStep,
  draftStep,
  finalStep,
  planStep,
  toolsStep,
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

function rowFor(node: NodeName, visit: number, ms: number, result: NodeResult): TraceRow {
  const detail = result.call?.retried ? `${result.detail} The first call timed out or could not connect, so it was tried once more.` : result.detail
  const row: TraceRow = { node, visit, status: result.status ?? 'ok', ms, detail }
  if (result.route) row.next = result.route.label
  if (result.call) {
    const { model, reply } = result.call
    row.model = model
    row.servedModel = reply.servedModel
    row.usage = reply.usage
    const priced = costFor(reply.servedModel ?? model, reply.usage)
    if (priced) {
      row.cost = priced.cost
      row.costSource = priced.source
    }
  }
  return row
}

function failedRow(node: NodeName, visit: number, ms: number, err: unknown): TraceRow {
  return {
    node,
    visit,
    status: 'failed',
    ms,
    detail: plainMessageOf(err) ?? SERVER_ERROR,
  }
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

  const wrap =
    (name: NodeName, run: (state: ResearchValues, ctx: NodeContext) => NodeResult | Promise<NodeResult>) =>
    async (state: ResearchValues, config: LangGraphRunnableConfig): Promise<Partial<ResearchValues>> => {
      const write = config.writer ?? (() => undefined)
      const visit = state.trace.filter((row) => row.node === name).length + 1
      write({ kind: 'start', node: name, visit, ms: Date.now() - origin } satisfies StartChunk)
      const began = Date.now()
      try {
        const result = await run(state, deps)
        const row = rowFor(name, visit, Date.now() - began, result)
        return { ...result.update, route: result.route ?? null, trace: [row] }
      } catch (err) {
        write({ kind: 'failed', row: failedRow(name, visit, Date.now() - began, err) } satisfies FailedChunk)
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
