import { END, MemorySaver, Send, START, StateGraph } from '@langchain/langgraph'
import { GraphState, type GraphStateType } from './graph-state'
import { makeNodes, type ExtractInput, type NodeDeps } from './nodes'

/** After split: one Send per chunk. The extract tasks run together, held to the limiter's concurrency. */
function fanOut(state: GraphStateType): Send[] {
  const total = state.chunks.length
  return state.chunks.map((chunk) => new Send('extract', { chunk, total, pass: 1 } satisfies ExtractInput))
}

/** After check: a retry sends only the missing chunks back through extract. Otherwise the run finishes. */
function afterCheck(state: GraphStateType): Send[] | 'final' {
  if (state.decision !== 'retry') return 'final'
  const missing = new Set(state.coverage.missing)
  const total = state.chunks.length
  return state.chunks
    .filter((chunk) => missing.has(chunk.id))
    .map((chunk) => new Send('extract', { chunk, total, pass: 2 } satisfies ExtractInput))
}

/**
 * After reduce: the first pass always goes on to synthesize. After a retry, reduce may decide that a second
 * synthesis and check would not help or would not fit the budget, and then the run finishes on the
 * first-pass summary.
 */
function afterReduce(state: GraphStateType): 'synthesize' | 'final' {
  return state.retries > 0 && state.decision === 'final' ? 'final' : 'synthesize'
}

/**
 * The map-reduce graph: split, fan out to parallel extract nodes, reduce, synthesize, check, and
 * either one bounded retry of the missing chunks or the final node. Built per request.
 */
export function buildGraph(deps: NodeDeps) {
  const nodes = makeNodes(deps)
  return new StateGraph(GraphState)
    .addNode('split', nodes.split)
    .addNode('extract', nodes.extract)
    .addNode('reduce', nodes.reduce)
    .addNode('synthesize', nodes.synthesize)
    .addNode('check', nodes.check)
    .addNode('final', nodes.final)
    .addEdge(START, 'split')
    .addConditionalEdges('split', fanOut, ['extract'])
    .addEdge('extract', 'reduce')
    .addConditionalEdges('reduce', afterReduce, ['synthesize', 'final'])
    .addEdge('synthesize', 'check')
    .addConditionalEdges('check', afterCheck, ['extract', 'final'])
    .addEdge('final', END)
    .compile({ checkpointer: new MemorySaver() })
}
