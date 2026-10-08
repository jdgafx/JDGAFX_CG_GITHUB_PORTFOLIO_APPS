import { Annotation } from '@langchain/langgraph'
import type { Decision, Extracted, HumanDecision, PolicyResult, Reply, RunStatus, TraceRow } from '../../src/types'

/** A channel that keeps the value written last, starting from `fallback`. */
function lastValue<T>(fallback: () => T) {
  return Annotation<T>({ reducer: (_current: T, next: T) => next, default: fallback })
}

/**
 * The graph state. LangGraph forbids a node and a state key with the same name, and the nodes
 * are called policy and reply, so the policy verdict and the reply email are stored as
 * policyResult and replyEmail.
 */
export const GraphState = Annotation.Root({
  ticket: lastValue(() => ''),
  extracted: lastValue<Extracted | null>(() => null),
  policyResult: lastValue<PolicyResult | null>(() => null),
  decision: lastValue<Decision | null>(() => null),
  humanDecision: lastValue<HumanDecision | null>(() => null),
  replyEmail: lastValue<Reply | null>(() => null),
  status: lastValue<RunStatus>(() => 'running'),
  trace: Annotation<TraceRow[]>({
    reducer: (current: TraceRow[], next: TraceRow[]) => current.concat(next),
    default: () => [],
  }),
})

export type GraphValues = typeof GraphState.State
