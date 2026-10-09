import type { AgentRole, AgentState } from '../types'
import { AGENT_ORDER, MODEL_ORDER, hasUsefulOutput, wasTruncated } from './agents'
import { formatUsd } from './usage'

export type RunPhase = 'ready' | 'running' | 'complete' | 'partial' | 'stopped' | 'failed'
export type AgentMap = Record<AgentRole, AgentState>

/** The words for why a stage was tried a second time. */
const RETRY_WORDS: Record<string, string> = {
  timeout: 'a timeout',
  connection: 'a dropped connection',
  provider: 'a provider error',
  reply: 'an empty or cut-off reply',
}

/** "Retried once after a timeout", or nothing when the stage ran once. */
export function retryLine(reason: string | undefined): string[] {
  return reason ? [`Retried once after ${RETRY_WORDS[reason] ?? 'a failed attempt'}`] : []
}

/** One line in the run trace for a stage. */
export function traceDetail(agent: AgentState): string {
  switch (agent.status) {
    case 'idle':
      return 'Waiting to start.'
    case 'working':
      return 'Model call in progress.'
    case 'complete':
      return agent.detail
    case 'error':
      return agent.error ?? 'Failed.'
    case 'skipped':
      return agent.detail
    case 'stopped':
      return 'Stopped before it finished.'
  }
}

/** The figures on the right of a finished trace line: the sources found, or the tokens and cost. */
export function traceMeta(agent: AgentState): string[] {
  if (agent.status !== 'complete') return []
  if (agent.id === 'retriever') {
    const count = agent.sources?.length ?? 0
    return [`${count} ${count === 1 ? 'source' : 'sources'}`]
  }
  const tokens = agent.usage?.completion_tokens
  const cost = agent.usage?.cost
  return [
    ...retryLine(agent.retried),
    tokens !== undefined ? `${tokens.toLocaleString('en-US')} output tokens` : 'output tokens not reported',
    cost !== undefined ? formatUsd(cost) : 'cost not reported',
  ]
}

/** Once the stream has ended nothing can still be running. Each unfinished stage says why. */
export function settleAgents(prev: AgentMap, stopped: boolean): AgentMap {
  const next = { ...prev }
  for (const role of AGENT_ORDER) {
    const agent = prev[role]
    if (agent.status === 'working') {
      next[role] = stopped
        ? { ...agent, status: 'stopped', detail: 'Stopped before it finished.' }
        : { ...agent, status: 'error', error: 'The connection ended before this stage finished.', detail: 'The connection ended before this stage finished.' }
    } else if (agent.status === 'idle') {
      next[role] = { ...agent, status: 'skipped', detail: stopped ? 'Not started: the run was stopped.' : 'Not started: the run ended first.' }
    }
  }
  return next
}

/** A system-level failure ends every stage still in flight, so none pulses behind the error. */
export function failInFlight(prev: AgentMap, message: string): AgentMap {
  const next = { ...prev }
  for (const role of AGENT_ORDER) {
    const agent = prev[role]
    if (agent.status === 'working') next[role] = { ...agent, status: 'error', error: message, detail: message }
  }
  return next
}

export function derivePhase(agents: AgentMap, isRunning: boolean, wasStopped: boolean): RunPhase {
  if (isRunning) return 'running'
  if (AGENT_ORDER.every(role => agents[role].status === 'idle')) return 'ready'
  if (wasStopped) return 'stopped'
  if (MODEL_ORDER.every(role => agents[role].status === 'complete' && hasUsefulOutput(agents[role]) && !wasTruncated(agents[role])))
    return 'complete'
  if (MODEL_ORDER.some(role => agents[role].output.trim().length > 0)) return 'partial'
  return 'failed'
}
