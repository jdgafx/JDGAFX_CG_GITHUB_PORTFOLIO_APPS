import { Annotation } from '@langchain/langgraph'
import type { Chunk, Coverage, Finding, Merged, Outcome, Summary, TraceRow } from '../../src/types/frames'

/** A channel that keeps the latest value written. `init` builds a fresh default for each run. */
const last = <T>(init: () => T) => Annotation<T>({ reducer: (_old, next) => next, default: init })

/**
 * Graph state. Parallel extract tasks write only to the two append reducers (findings, trace), so
 * concurrent writes never collide. Every other field is written by exactly one node per step.
 */
export const GraphState = Annotation.Root({
  text: last<string>(() => ''),
  chunks: last<Chunk[]>(() => []),
  findings: Annotation<Finding[]>({
    reducer: (old, next) => old.concat(next),
    default: () => [],
  }),
  trace: Annotation<TraceRow[]>({
    reducer: (old, next) => old.concat(next),
    default: () => [],
  }),
  merged: last<Merged | null>(() => null),
  summary: last<Summary | null>(() => null),
  coverage: last<Coverage>(() => ({ covered: [], missing: [], noPoints: [] })),
  retries: last<number>(() => 0),
  /** Set by check: 'retry' sends the missing chunks back through extract, 'final' ends the run. */
  decision: last<'retry' | 'final'>(() => 'final'),
  /** Written by check when it skips the retry for lack of time. The final outcome carries it as its notice. */
  notice: last<string | null>(() => null),
  /** Chunks the review model flagged on the latest check. Advisory only. */
  reviewFlags: last<number[]>(() => []),
  /** Named outcome, not final: LangGraph does not allow a state key and a node with the same name. */
  outcome: last<Outcome | null>(() => null),
  /** Written by every check: the outcome as it stands after that pass. A retry that fails returns it. */
  draft: last<Outcome | null>(() => null),
})

export type GraphStateType = typeof GraphState.State
