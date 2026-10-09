import type { AgentRole, AgentState } from '../types'
import { AGENT_META, AGENT_ORDER, foundNoSources, statusView, wasTruncated } from './agents'
import type { AuditPhase } from './auditState'

/** Every box in the graph: the five pipeline steps, then the audit of the finished report. */
export type StepId = AgentRole | 'audit'
export const STEP_ORDER: StepId[] = [...AGENT_ORDER, 'audit']

/** What a box shows. Colour never carries it alone: every mark has a word. */
export type Mark = 'idle' | 'active' | 'ok' | 'warn' | 'failed' | 'skipped' | 'stopped'

export interface Step {
  id: StepId
  title: string
  sub: string
  mark: Mark
  word: string
  ms?: number
}

export interface Box {
  id: StepId
  x: number
  y: number
  w: number
  h: number
}

export interface EdgeShape {
  from: StepId
  to: StepId
  path: string
  label: string
  labelAt: { x: number; y: number; anchor: 'start' | 'middle' }
}

export interface Layout {
  view: { width: number; height: number }
  boxes: Box[]
  edges: EdgeShape[]
}

const SUBS: Record<StepId, string> = {
  retriever: 'Wikipedia, Hacker News',
  researcher: 'cited facts',
  analyst: 'patterns',
  critic: 'gaps',
  synthesizer: 'final report',
  audit: 'claims vs. source text',
}

const EDGE_LABELS = ['Sources', 'Research', 'Analysis', 'Gaps', 'Report']
const BOX_H = 76

const AUDIT_STEP: Record<AuditPhase, { mark: Mark; word: string }> = {
  idle: { mark: 'idle', word: 'Waiting' },
  none: { mark: 'skipped', word: 'Nothing to check' },
  running: { mark: 'active', word: 'Auditing' },
  done: { mark: 'ok', word: 'Finished' },
  failed: { mark: 'failed', word: 'Failed' },
  stopped: { mark: 'stopped', word: 'Stopped' },
}

function agentMark(agent: AgentState): Mark {
  switch (agent.status) {
    case 'idle':
      return 'idle'
    case 'working':
      return 'active'
    case 'complete':
      return wasTruncated(agent) || foundNoSources(agent) ? 'warn' : 'ok'
    case 'error':
      return 'failed'
    case 'skipped':
      return 'skipped'
    case 'stopped':
      return 'stopped'
  }
}

/** The six boxes as the page shows them, from the pipeline state and the audit phase. */
export function buildSteps(agents: Record<AgentRole, AgentState>, audit: { phase: AuditPhase; ms?: number }): Step[] {
  const pipeline = AGENT_ORDER.map<Step>(id => ({
    id,
    title: AGENT_META[id].name,
    sub: SUBS[id],
    mark: agentMark(agents[id]),
    word: statusView(agents[id]).word,
    ...(agents[id].ms !== undefined ? { ms: agents[id].ms } : {}),
  }))
  const state = AUDIT_STEP[audit.phase]
  return [...pipeline, { id: 'audit', title: 'Audit', sub: SUBS.audit, mark: state.mark, word: state.word, ...(audit.ms !== undefined ? { ms: audit.ms } : {}) }]
}

/** A hand-off is taken once the step it leads to has started (or, for the audit, has been asked for). */
export function takenEdges(steps: Step[]): boolean[] {
  return steps.slice(1).map(step => step.mark !== 'idle' && step.mark !== 'skipped')
}

function edgeBetween(a: Box, b: Box, label: string): EdgeShape {
  if (a.y === b.y) {
    const y = a.y + a.h / 2
    const right = b.x > a.x
    const x1 = right ? a.x + a.w : a.x
    const x2 = right ? b.x : b.x + b.w
    return { from: a.id, to: b.id, path: `M${x1} ${y} H${x2}`, label, labelAt: { x: (x1 + x2) / 2, y: y - 10, anchor: 'middle' } }
  }
  const x = a.x + a.w / 2
  const y1 = a.y + a.h
  return { from: a.id, to: b.id, path: `M${x} ${y1} V${b.y}`, label, labelAt: { x: x + 12, y: (y1 + b.y) / 2 + 4, anchor: 'start' } }
}

function layoutOf(boxes: Box[], width: number, height: number): Layout {
  const edges = boxes.slice(0, -1).map((box, i) => edgeBetween(box, boxes[i + 1] ?? box, EDGE_LABELS[i] ?? ''))
  return { view: { width, height }, boxes, edges }
}

/** Wide: the six steps snake three to a row, so every hand-off is a short line right, down or left. */
export function wideLayout(): Layout {
  const w = 220
  const gap = 110
  const rows = [34, 34 + BOX_H + 52]
  const columns = [0, w + gap, 2 * (w + gap)]
  const boxes = STEP_ORDER.map<Box>((id, i) => {
    const row = Math.floor(i / 3)
    const offset = i % 3
    const column = row % 2 === 0 ? offset : 2 - offset
    return { id, x: columns[column] ?? 0, y: rows[row] ?? 0, w, h: BOX_H }
  })
  return layoutOf(boxes, 880, (rows[1] ?? 0) + BOX_H + 16)
}

/** Narrow: one column of full-width boxes, so a phone shows the whole pipeline with text at full size. */
export function narrowLayout(): Layout {
  const gap = 24
  const boxes = STEP_ORDER.map<Box>((id, i) => ({ id, x: 8, y: 8 + i * (BOX_H + gap), w: 324, h: BOX_H }))
  return layoutOf(boxes, 340, 8 + STEP_ORDER.length * BOX_H + (STEP_ORDER.length - 1) * gap + 8)
}
