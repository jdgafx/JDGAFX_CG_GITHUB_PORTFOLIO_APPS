import { Annotation } from '@langchain/langgraph'
import type { Evidence } from '../citations'
import type { CostSource, EndingView, NodeName, NodeStatus, SourceView } from '../events'
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
  /** True when the visitor's edit stands in for what the step produced. */
  edited?: boolean
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
  ending: EndingView
}

/** A field the latest update replaces. `initial` builds the starting value, so no run shares an array. */
const last = <T>(initial: () => T) => Annotation<T>({ reducer: (_prev, next) => next, default: initial })

/** A list field where each update appends. */
const appended = <T>() => Annotation<T[]>({ reducer: (prev, next) => prev.concat(next), default: () => [] })

export const ResearchState = Annotation.Root({
  question: last(() => ''),
  searchQueries: last<string[]>(() => []),
  /** The agent's conversation: its turns and the tool results, in order. Each update appends. */
  messages: appended<ChatMessage>(),
  pendingCalls: last<ToolCall[]>(() => []),
  toolRounds: last(() => 0),
  /** Pages the agent read, numbered in order. Each update appends the new pages only. */
  evidence: appended<Evidence>(),
  draftText: last(() => ''),
  /** Whether the latest draft hit its length limit. */
  draftTruncated: last(() => false),
  /** Whether the critic has read the latest draft. */
  draftReviewed: last(() => false),
  /** Set by a step that skipped work for lack of time, so the final answer says so. */
  ending: last<EndingView | null>(() => null),
  critique: last<Critique | null>(() => null),
  revisions: last(() => 0),
  route: last<Route | null>(() => null),
  finalAnswer: last<FinalAnswer | null>(() => null),
  trace: appended<TraceRow>(),
})

export type ResearchValues = typeof ResearchState.State
