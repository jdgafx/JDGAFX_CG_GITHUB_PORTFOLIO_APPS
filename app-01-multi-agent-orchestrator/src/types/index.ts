/** The four stages that call the model, in pipeline order. */
export type ModelRole = 'researcher' | 'analyst' | 'critic' | 'synthesizer'

/** Every step of a run. The retriever fetches public sources and makes no model call. */
export type AgentRole = 'retriever' | ModelRole

/** 'stopped' is set in the browser when the visitor ends the run during this stage. */
export type AgentStatus = 'idle' | 'working' | 'complete' | 'error' | 'skipped' | 'stopped'

/** Usage as the provider reports it. A missing field means the provider did not report it. */
export interface StageUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  /** USD, from usage.cost in the provider response. */
  cost?: number
}

/** One retrieved public source. `n` is the number the Researcher cites as [n]. */
export interface Source {
  n: number
  title: string
  site: 'Wikipedia' | 'Hacker News'
  /** A link the server built itself from validated ids, always https. */
  url: string
  /** The capped text the Researcher was given, shown to the visitor as it was sent. */
  snippet: string
  /** A short line such as "764 points, 526 comments, Jan 2023". */
  note?: string
}

export interface TraceStep {
  name: string
  status: 'ok' | 'cut off' | 'failed' | 'skipped'
  ms: number
  detail: string
  tokens?: number
  cost?: number
}

export interface RunSummary {
  result: string
  trace: TraceStep[]
  usage: StageUsage
  model?: string
  totalMs: number
}

export interface AgentState {
  id: AgentRole
  name: string
  description: string
  status: AgentStatus
  output: string
  maxTokens: number
  /** One line for the trace: the key output, or why the stage did not finish. */
  detail: string
  error?: string
  ms?: number
  finish: string | null
  reasoningTokens: number
  usage?: StageUsage
  servedModel?: string
  /** Set on the retriever only: what it found. An empty list means it found nothing. */
  sources?: Source[]
}

/** Every event the server streams. Both sides import this type, so keep it the only copy. */
export type StreamEvent =
  | { type: 'retrieve_start' }
  | { type: 'retrieve_complete'; ms: number; sources: Source[]; detail: string }
  | { type: 'agent_start'; agent: ModelRole; maxTokens: number }
  | { type: 'agent_chunk'; agent: ModelRole; content: string }
  | {
      type: 'agent_complete'
      agent: ModelRole
      ms: number
      detail: string
      finish: string | null
      reasoningTokens: number
      servedModel?: string
      usage: StageUsage
    }
  | { type: 'agent_skipped'; agent: ModelRole; detail: string }
  | { type: 'agent_error'; agent: ModelRole | 'system'; ms?: number; error: string }
  | ({ type: 'session_complete'; agent: 'synthesizer' } & RunSummary)
