import { Annotation } from '@langchain/langgraph'
import type { Chunk, Coverage, Finding, Merged, Outcome, Summary, TraceRow } from '../../src/types/frames'

/**
 * Graph state. Parallel extract tasks write only to the two append reducers (findings, trace), so
 * concurrent writes never collide. Every other field is written by exactly one node per step.
 */
export const GraphState = Annotation.Root({
  text: Annotation<string>({
    reducer: (_old, next) => next,
    default: () => '',
  }),
  chunks: Annotation<Chunk[]>({
    reducer: (_old, next) => next,
    default: () => [],
  }),
  findings: Annotation<Finding[]>({
    reducer: (old, next) => old.concat(next),
    default: () => [],
  }),
  trace: Annotation<TraceRow[]>({
    reducer: (old, next) => old.concat(next),
    default: () => [],
  }),
  merged: Annotation<Merged | null>({
    reducer: (_old, next) => next,
    default: () => null,
  }),
  summary: Annotation<Summary | null>({
    reducer: (_old, next) => next,
    default: () => null,
  }),
  coverage: Annotation<Coverage>({
    reducer: (_old, next) => next,
    default: () => ({ covered: [], missing: [] }),
  }),
  retries: Annotation<number>({
    reducer: (_old, next) => next,
    default: () => 0,
  }),
  /** Set by check: 'retry' sends the missing chunks back through extract, 'final' ends the run. */
  decision: Annotation<'retry' | 'final'>({
    reducer: (_old, next) => next,
    default: () => 'final',
  }),
  /** Named outcome, not final: LangGraph does not allow a state key and a node with the same name. */
  outcome: Annotation<Outcome | null>({
    reducer: (_old, next) => next,
    default: () => null,
  }),
  /** Written by every check: the outcome as it stands after that pass. A retry that fails returns it. */
  draft: Annotation<Outcome | null>({
    reducer: (_old, next) => next,
    default: () => null,
  }),
})

export type GraphStateType = typeof GraphState.State
