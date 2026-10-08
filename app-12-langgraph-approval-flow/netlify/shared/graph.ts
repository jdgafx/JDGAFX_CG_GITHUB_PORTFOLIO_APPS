import { END, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph'
import { decideNode, intakeNode, policyNode, replyNode, reviewNode, type NodeDeps } from './nodes'
import { GraphState } from './state'

export interface GraphDeps extends NodeDeps {
  checkpointer: BaseCheckpointSaver
}

/** The label on decide's conditional edges. The browser shows the same two labels. */
export function routeAfterDecide(requiresHuman: boolean): 'requiresHuman' | 'otherwise' {
  return requiresHuman ? 'requiresHuman' : 'otherwise'
}

/**
 * START -> intake -> policy -> decide, then either review -> reply (requiresHuman) or reply
 * (otherwise), then END. The graph has no cycles. Review is the only pause, and it is the
 * interrupt() call that stores the proposal in the checkpoint.
 */
export function buildGraph(deps: GraphDeps) {
  return new StateGraph(GraphState)
    .addNode('intake', (state, config) => intakeNode(state, config, deps))
    .addNode('policy', (state, config) => policyNode(state, config, deps))
    .addNode('decide', (state, config) => decideNode(state, config, deps))
    .addNode('review', (state, config) => reviewNode(state, config, deps))
    .addNode('reply', (state, config) => replyNode(state, config, deps))
    .addEdge(START, 'intake')
    .addEdge('intake', 'policy')
    .addEdge('policy', 'decide')
    .addConditionalEdges('decide', (state) => routeAfterDecide(state.policyResult?.requiresHuman === true), {
      requiresHuman: 'review',
      otherwise: 'reply',
    })
    .addEdge('review', 'reply')
    .addEdge('reply', END)
    .compile({ checkpointer: deps.checkpointer })
}

export type GraphInstance = ReturnType<typeof buildGraph>
