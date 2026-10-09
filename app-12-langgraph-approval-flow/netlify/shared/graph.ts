import { END, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph'
import { classifyNode, decideNode, replyNode, reviewNode, type NodeDeps } from './nodes'
import { GraphState } from './state'

/**
 * START -> classify -> decide, then either review -> reply (requiresHuman) or reply (otherwise), then
 * END. The graph has no cycles. Review is the only pause, and it is the interrupt() call that stores
 * the proposal in the checkpoint. The edge labels are the ones the browser shows.
 */
export function buildGraph(deps: NodeDeps & { checkpointer: BaseCheckpointSaver }) {
  return new StateGraph(GraphState)
    .addNode('classify', (state, config) => classifyNode(state, config, deps))
    .addNode('decide', (state, config) => decideNode(state, config))
    .addNode('review', (state, config) => reviewNode(state, config))
    .addNode('reply', (state, config) => replyNode(state, config, deps))
    .addEdge(START, 'classify')
    .addEdge('classify', 'decide')
    .addConditionalEdges('decide', (state) => (state.triage?.requiresHuman === true ? 'requiresHuman' : 'otherwise'), {
      requiresHuman: 'review',
      otherwise: 'reply',
    })
    .addEdge('review', 'reply')
    .addEdge('reply', END)
    .compile({ checkpointer: deps.checkpointer })
}

export type GraphInstance = ReturnType<typeof buildGraph>
