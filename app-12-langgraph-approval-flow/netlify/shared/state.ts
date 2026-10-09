import { Annotation } from '@langchain/langgraph'
import type { Classification, DuplicateReport, HumanDecision, IssueInput, Reply, RunStatus, TraceRow, Triage } from '../../src/types'

/** A channel that keeps the value written last, starting from `fallback`. */
function lastValue<T>(fallback: () => T) {
  return Annotation<T>({ reducer: (_current: T, next: T) => next, default: fallback })
}

/**
 * The graph state. LangGraph forbids a node and a state key with the same name, and the nodes are
 * called classify, decide, review and reply, so the verdicts are stored as classification, triage and replyDraft.
 */
export const GraphState = Annotation.Root({
  issue: lastValue<IssueInput | null>(() => null),
  classification: lastValue<Classification | null>(() => null),
  duplicateReport: lastValue<DuplicateReport | null>(() => null),
  triage: lastValue<Triage | null>(() => null),
  humanDecision: lastValue<HumanDecision | null>(() => null),
  replyDraft: lastValue<Reply | null>(() => null),
  status: lastValue<RunStatus>(() => 'running'),
  trace: Annotation<TraceRow[]>({
    reducer: (current: TraceRow[], next: TraceRow[]) => current.concat(next),
    default: () => [],
  }),
})

export type GraphValues = typeof GraphState.State
