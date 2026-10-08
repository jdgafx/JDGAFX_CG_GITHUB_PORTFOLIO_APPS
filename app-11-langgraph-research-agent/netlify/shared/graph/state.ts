import { Annotation } from '@langchain/langgraph'
import type { Evidence } from '../citations'
import type { CostSource, NodeName, NodeStatus, SourceView } from '../events'
import type { ChatMessage, TokenUsage, ToolCall } from '../openrouter'

/** The most tool rounds the agent may run before it must draft. */
export const MAX_TOOL_ROUNDS = 4
/** The most times the critic may send the draft back. A later revise verdict ends at final. */
export const MAX_REVISIONS = 2

/** The nodes a conditional edge can lead to. */
export type Target = 'tools' | 'draft' | 'final'

/** One visit to one node, as the trace shows it. */
export interface TraceRow {
  node: NodeName
  visit: number
  status: NodeStatus
  ms: number
  detail: string
  /** The label of the conditional edge taken after this visit, when there was one. */
  next?: string
  /** The model the node asked for. */
  model?: string
  /** The model OpenRouter says served the reply, or null when it named none. */
  servedModel?: string | null
  usage?: TokenUsage
  cost?: number
  costSource?: CostSource
}

export interface Critique {
  verdict: 'accept' | 'revise'
  notes: string
  /** False when the critic reply could not be read, so the draft went out unreviewed. */
  reviewed: boolean
}

/** Written by the node that decides, and read by the router right after it. */
export interface Route {
  to: Target
  label: string
}

export interface FinalAnswer {
  answer: string
  sources: SourceView[]
  /** True when the draft behind this answer hit its length limit. */
  truncated: boolean
}

export const ResearchState = Annotation.Root({
  question: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  searchQueries: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  /** The agent's conversation: its turns and the tool results, in order. Each update appends. */
  messages: Annotation<ChatMessage[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
  pendingCalls: Annotation<ToolCall[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  toolRounds: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  /** Pages the agent read, numbered in order. Each update appends the new pages only. */
  evidence: Annotation<Evidence[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
  draftText: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  /** Whether the latest draft hit its length limit. */
  draftTruncated: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
  critique: Annotation<Critique | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  revisions: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  route: Annotation<Route | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  finalAnswer: Annotation<FinalAnswer | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  trace: Annotation<TraceRow[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
})

export type ResearchValues = typeof ResearchState.State
