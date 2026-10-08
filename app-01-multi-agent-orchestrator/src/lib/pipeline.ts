import type { Edge, Node } from '@xyflow/react'
import type { AgentRole, AgentState } from '../types'
import { AGENT_ORDER, hasUsefulOutput, wasTruncated } from './agents'

export type RunPhase = 'ready' | 'running' | 'complete' | 'partial' | 'stopped' | 'failed'
export type AgentMap = Record<AgentRole, AgentState>
/** Row: the four stages in one line. Grid: two rows of two, used below 1200px. */
export type GraphLayout = 'row' | 'grid'

/** Node size and spacing in pixels. app.css sets the same node size. */
export const NODE_WIDTH = 136
export const NODE_HEIGHT = 128
const GAP_X = 72
const GAP_Y = 40

/** What each hand-off passes on: the Analyst reads research, the Critic reads analysis, the Synthesizer reads gaps. */
const EDGE_LABELS = ['Research', 'Analysis', 'Gaps']

export function nodePosition(index: number, layout: GraphLayout): { x: number; y: number } {
  if (layout === 'row') return { x: index * (NODE_WIDTH + GAP_X), y: 0 }
  return { x: (index % 2) * (NODE_WIDTH + GAP_X), y: Math.floor(index / 2) * (NODE_HEIGHT + GAP_Y) }
}

export function buildNodes(agents: AgentMap, layout: GraphLayout): Node[] {
  return AGENT_ORDER.map((role, i) => ({
    id: role,
    type: 'agent',
    position: nodePosition(i, layout),
    draggable: false,
    selectable: false,
    connectable: false,
    data: agents[role] as unknown as Record<string, unknown>,
  }))
}

/**
 * Brings the nodes in line with the agent state and the layout. A node keeps its object when its
 * state and place are unchanged, so a streamed chunk re-renders only the stage it belongs to. A
 * changed node keeps the size React Flow measured for it, so its edges stay drawn.
 */
export function refreshNodes(prev: Node[], agents: AgentMap, layout: GraphLayout): Node[] {
  const next = buildNodes(agents, layout)
  let changed = prev.length !== next.length
  const merged = next.map((node, i) => {
    const old = prev[i]
    if (!old || old.id !== node.id) {
      changed = true
      return node
    }
    if (old.data === node.data && old.position.x === node.position.x && old.position.y === node.position.y) return old
    changed = true
    return { ...old, data: node.data, position: node.position }
  })
  return changed ? merged : prev
}

/** An edge is taken once the stage it points to has started. Taken edges are drawn in the signal colour. */
export function buildEdges(agents: AgentMap, layout: GraphLayout): Edge[] {
  return AGENT_ORDER.slice(0, -1).map((source, i) => {
    const target = AGENT_ORDER[i + 1] ?? source
    const down = layout === 'grid' && i === 1
    const { status } = agents[target]
    const taken = status !== 'idle' && status !== 'skipped'
    return {
      id: `e-${source}`,
      source,
      target,
      sourceHandle: down ? 'source-bottom' : 'source-right',
      targetHandle: down ? 'target-top' : 'target-left',
      label: EDGE_LABELS[i],
      className: taken ? 'pipeline-edge pipeline-edge--taken' : 'pipeline-edge',
      selectable: false,
    }
  })
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
  if (AGENT_ORDER.every(role => agents[role].status === 'complete' && hasUsefulOutput(agents[role]) && !wasTruncated(agents[role])))
    return 'complete'
  if (AGENT_ORDER.some(role => agents[role].output.trim().length > 0)) return 'partial'
  return 'failed'
}
