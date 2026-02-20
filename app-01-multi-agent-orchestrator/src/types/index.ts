export type AgentRole = 'researcher' | 'analyst' | 'critic' | 'synthesizer'

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'complete' | 'error'

export interface AgentState {
  id: AgentRole
  name: string
  description: string
  status: AgentStatus
  output: string
  tokens: number
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
  agent: AgentRole
  content?: string
  tokens?: number
  error?: string
}
