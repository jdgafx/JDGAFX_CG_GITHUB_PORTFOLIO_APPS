import type { NodeName } from '../../netlify/shared/events'
import { MAX_REVISIONS, MAX_TOOL_ROUNDS } from './constants'
import type { NodeMark, TraceEntry } from './runState'

/**
 * The graph as a column of five steps, with the tools loop beside the agent and the revise loop
 * beside the draft and critic. Units are SVG user units, drawn at 1:1 so the text keeps its size.
 */
export const VIEW = { width: 560, height: 492 }

export interface NodeBox {
  x: number
  y: number
  w: number
  h: number
  title: string
  sub: string
}

export const BOXES: Record<NodeName, NodeBox> = {
  plan: { x: 170, y: 24, w: 180, h: 60, title: 'plan', sub: 'search queries' },
  agent: { x: 170, y: 116, w: 180, h: 60, title: 'agent', sub: 'decides on tools' },
  tools: { x: 420, y: 116, w: 120, h: 60, title: 'tools', sub: 'Wikipedia' },
  draft: { x: 170, y: 208, w: 180, h: 60, title: 'draft', sub: 'cited answer' },
  critic: { x: 170, y: 300, w: 180, h: 60, title: 'critic', sub: 'accept or revise' },
  final: { x: 170, y: 392, w: 180, h: 60, title: 'final', sub: 'sources listed' },
}

export interface EdgeShape {
  /** "from>to", the key the run view uses for the labels taken. */
  key: string
  path: string
  conditional: boolean
  /** Where the label sits, and the text shown before any decision is taken. */
  label?: { x: number; y: number; anchor: 'start' | 'middle' | 'end'; base: string }
}

/** Every edge drawn. The unconditional edges carry no label, and the run marks them taken from the trace. */
export const EDGES: EdgeShape[] = [
  { key: 'plan>agent', path: 'M260 84 V116', conditional: false },
  {
    key: 'agent>tools',
    path: 'M330 116 C330 80 480 80 480 116',
    conditional: true,
    label: { x: 362, y: 66, anchor: 'start', base: `tools, up to ${MAX_TOOL_ROUNDS} rounds` },
  },
  { key: 'tools>agent', path: 'M480 176 C480 212 330 212 330 176', conditional: false },
  {
    key: 'agent>draft',
    path: 'M260 176 V208',
    conditional: true,
    label: { x: 250, y: 196, anchor: 'end', base: 'draft' },
  },
  { key: 'draft>critic', path: 'M260 268 V300', conditional: false },
  {
    key: 'critic>final',
    path: 'M260 360 V392',
    conditional: true,
    label: { x: 250, y: 380, anchor: 'end', base: 'final' },
  },
  {
    key: 'critic>draft',
    path: 'M350 330 H392 V238 H350',
    conditional: true,
    label: { x: 402, y: 286, anchor: 'start', base: `revise, up to ${MAX_REVISIONS} times` },
  },
]

/** The arrow from the final node to the end of the run, and the key the run view uses for it. */
export const END_KEY = 'final>end'
export const END_PATH = 'M260 452 V470'
export const START_LABEL = { x: 260, y: 14 }
export const END_LABEL = { x: 260, y: 486 }

/** The edges a run has moved along, read from the trace in visit order. A finished final step ends at the end. */
export function traversedEdges(trace: readonly TraceEntry[]): Set<string> {
  const keys = new Set<string>()
  let previous: TraceEntry | undefined
  for (const entry of trace) {
    if (previous) keys.add(`${previous.node}>${entry.node}`)
    previous = entry
  }
  if (previous && previous.node === 'final' && previous.status === 'ok') keys.add(END_KEY)
  return keys
}

/** The server's label, reworded for the page: "tools (round 2 of 4)" reads "tools, round 2 of 4". */
export function displayLabel(label: string): string {
  return label.replace(' (', ', ').replace(/\)$/, '')
}

/**
 * The mark a step shows. The marks hold the latest visit, so a step whose last visit was skipped
 * (its tool budget was spent) still shows finished when an earlier visit finished.
 */
export function shownMark(
  name: NodeName,
  marks: Readonly<Record<NodeName, NodeMark>>,
  trace: readonly TraceEntry[],
): NodeMark {
  const mark = marks[name]
  if (mark !== 'skipped') return mark
  return trace.some((entry) => entry.node === name && entry.status === 'ok') ? 'ok' : 'skipped'
}

/** The text on a conditional edge: its bound before any decision, then the latest decision taken. */
export function labelText(edge: EdgeShape, taken: Readonly<Record<string, string>>): string | undefined {
  if (!edge.label) return undefined
  const decided = taken[edge.key]
  return decided === undefined ? edge.label.base : displayLabel(decided)
}
