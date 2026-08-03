export type AgentRole = 'researcher' | 'analyst' | 'critic' | 'synthesizer'

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'complete' | 'stopped' | 'error'

export interface AgentState {
  id: AgentRole
  name: string
  description: string
  status: AgentStatus
  output: string
  /** Content tokens reported by the server — excludes upstream reasoning tokens. */
  tokens: number
  /** Non-zero means the model spent budget thinking; surfaced as a warning. */
  reasoningTokens: number
  /** Upstream stop reason: 'stop' when the agent finished, 'length'/'timeout' when cut off. */
  finish: string | null
  /** Per-agent token ceiling, used to show real generation progress. */
  maxTokens: number
  error?: string
  startTime?: number
  endTime?: number
}

export interface ResearchSession {
  id: string
  query: string
  status: 'idle' | 'running' | 'complete' | 'error'
  agents: Record<AgentRole, AgentState>
  finalReport: string
  totalTokens: number
  startTime?: number
  endTime?: number
}

export interface StreamEvent {
  type: 'agent_start' | 'agent_chunk' | 'agent_complete' | 'agent_error' | 'session_complete'
  agent: AgentRole | 'system'
  content?: string
  tokens?: number
  reasoningTokens?: number
  finish?: string | null
  maxTokens?: number
  error?: string
}
