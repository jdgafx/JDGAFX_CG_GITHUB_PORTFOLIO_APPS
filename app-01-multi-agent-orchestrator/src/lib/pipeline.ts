import type { Edge, Node } from '@xyflow/react'
import type { AgentRole, AgentState } from '../types'
import { AGENT_ORDER, MODEL_ORDER, hasUsefulOutput, wasTruncated } from './agents'
import { formatUsd } from './usage'

export type RunPhase = 'ready' | 'running' | 'complete' | 'partial' | 'stopped' | 'failed'
export type AgentMap = Record<AgentRole, AgentState>
/** Steps snake across the graph: three per row, or two per row on phones. */
export type GraphLayout = 'cols3' | 'cols2'

const COLUMNS: Record<GraphLayout, number> = { cols3: 3, cols2: 2 }

/** Node size and spacing in pixels. app.css sets the same node size. */
const NODE_WIDTH = 136
const NODE_HEIGHT = 128
const GAP_X = 72
const GAP_Y = 40

/** What each hand-off passes on: the Researcher reads the sources, the Analyst reads research, the Critic reads analysis, the Synthesizer reads gaps. */
const EDGE_LABELS = ['Sources', 'Research', 'Analysis', 'Gaps']

/** Rows alternate direction, so each hand-off is a short step right, left or down. */
export function nodePosition(index: number, layout: GraphLayout): { x: number; y: number } {
  const columns = COLUMNS[layout]
  const row = Math.floor(index / columns)
  const offset = index % columns
  const column = row % 2 === 0 ? offset : columns - 1 - offset
  return { x: column * (NODE_WIDTH + GAP_X), y: row * (NODE_HEIGHT + GAP_Y) }
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

/** Which sides of two nodes an edge joins: across a row, or down to the next one. */
export function edgeHandles(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { sourceHandle: string; targetHandle: string } {
  if (to.y > from.y) return { sourceHandle: 'source-bottom', targetHandle: 'target-top' }
  if (to.x < from.x) return { sourceHandle: 'source-left', targetHandle: 'target-right' }
  return { sourceHandle: 'source-right', targetHandle: 'target-left' }
}

/** An edge is taken once the stage it points to has started. Taken edges are drawn in the signal colour. */
export function buildEdges(agents: AgentMap, layout: GraphLayout): Edge[] {
  return AGENT_ORDER.slice(0, -1).map((source, i) => {
    const target = AGENT_ORDER[i + 1] ?? source
    const { status } = agents[target]
    const taken = status !== 'idle' && status !== 'skipped'
    return {
      id: `e-${source}`,
      source,
      target,
      ...edgeHandles(nodePosition(i, layout), nodePosition(i + 1, layout)),
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
    tokens !== undefined ? `${tokens.toLocaleString('en-US')} tokens` : 'tokens not reported',
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
