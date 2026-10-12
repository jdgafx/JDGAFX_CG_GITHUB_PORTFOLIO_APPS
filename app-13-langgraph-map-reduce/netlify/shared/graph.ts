import { END, Send, START, StateGraph } from '@langchain/langgraph'
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

/** Request 1, after reduce: chunks that gave no key points go back through extract once, then the request ends. */
function afterExtractReduce(state: GraphStateType): Send[] | typeof END {
  if (state.decision !== 'retry') return END
  const have = new Set(state.merged?.byChunk.map((c) => c.chunkId))
  const total = state.chunks.length
  return state.chunks.filter((chunk) => !have.has(chunk.id)).map((chunk) => new Send('extract', { chunk, total, pass: 2 } satisfies ExtractInput))
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
 * Which part of the run one request makes. all: the whole graph in one request, for in-process use and tests of single nodes. Production never runs it. extract: request 1, split, extract and
 * reduce, ending with the key points. synthesize: request 2, which starts at synthesize from state seeded with those key
 * points, and goes on through check and final (and the retry, if the budget ever allows one).
 */
export type Phase = 'all' | 'extract' | 'synthesize'

/**
 * The map-reduce graph: split, fan out to parallel extract nodes, reduce, synthesize, check, and
 * either one bounded retry of the missing chunks or the final node. Built per request.
 */
export function buildGraph(deps: NodeDeps, phase: Phase = 'all') {
  const nodes = makeNodes(phase === 'extract' ? { ...deps, retryEmpty: true } : deps)
  return new StateGraph(GraphState)
    .addNode('split', nodes.split)
    .addNode('extract', nodes.extract)
    .addNode('reduce', nodes.reduce)
    .addNode('synthesize', nodes.synthesize)
    .addNode('check', nodes.check)
    .addNode('final', nodes.final)
    // Both ends are declared so every node stays reachable; a request enters at the node its phase starts with.
    .addConditionalEdges(START, () => (phase === 'synthesize' ? 'synthesize' : 'split'), ['split', 'synthesize'])
    .addConditionalEdges('split', fanOut, ['extract'])
    .addEdge('extract', 'reduce')
    .addConditionalEdges('reduce', phase === 'extract' ? afterExtractReduce : afterReduce, ['synthesize', 'final', 'extract', END])
    .addEdge('synthesize', 'check')
    .addConditionalEdges('check', afterCheck, ['extract', 'final'])
    .addEdge('final', END)
    .compile()
}
