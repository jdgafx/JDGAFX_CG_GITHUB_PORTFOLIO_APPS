export type AgentRole = 'researcher' | 'analyst' | 'critic' | 'synthesizer'

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
}

/** Every event the server streams. Both sides import this type, so keep it the only copy. */
export type StreamEvent =
  | { type: 'agent_start'; agent: AgentRole; maxTokens: number }
  | { type: 'agent_chunk'; agent: AgentRole; content: string }
  | {
      type: 'agent_complete'
      agent: AgentRole
      ms: number
      detail: string
      finish: string | null
      reasoningTokens: number
      servedModel?: string
      usage: StageUsage
    }
  | { type: 'agent_skipped'; agent: AgentRole; detail: string }
  | { type: 'agent_error'; agent: AgentRole | 'system'; ms?: number; error: string }
  | ({ type: 'session_complete'; agent: 'synthesizer' } & RunSummary)
