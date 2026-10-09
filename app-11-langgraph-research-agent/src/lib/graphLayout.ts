import type { NodeName } from '../../netlify/shared/events'
import { MAX_REVISIONS, MAX_TOOL_ROUNDS } from './constants'
import type { NodeMark, TraceEntry } from './runState'

export interface NodeBox {
  x: number
  y: number
  w: number
  h: number
  title: string
  sub: string
}

export interface EdgeShape {
  /** "from>to", the key the run view uses for the labels taken. */
  key: string
  path: string
  conditional: boolean
  /** Where the label sits, and the text shown before any decision is taken. */
  label?: { x: number; y: number; anchor: 'start' | 'middle' | 'end'; base: string }
}

export interface Layout {
  view: { width: number; height: number }
  boxes: Record<NodeName, NodeBox>
  edges: EdgeShape[]
  endPath: string
  startLabel: { x: number; y: number }
  endLabel: { x: number; y: number }
}

const NODE_TEXT: Record<NodeName, { title: string; sub: string }> = {
  plan: { title: 'plan', sub: 'search queries' },
  agent: { title: 'agent', sub: 'decides on tools' },
  tools: { title: 'tools', sub: 'Wikipedia' },
  draft: { title: 'draft', sub: 'cited answer' },
  critic: { title: 'critic', sub: 'accept or revise' },
  final: { title: 'final', sub: 'sources listed' },
}

const box = (name: NodeName, x: number, y: number, w: number): NodeBox => ({ x, y, w, h: 64, ...NODE_TEXT[name] })
const TOOLS_BASE = `tools, up to ${MAX_TOOL_ROUNDS} rounds`
const REVISE_BASE = `revise, up to ${MAX_REVISIONS} times`

/**
 * Two drawings of one graph, units are SVG user units and the page scales them to the stage. The wide one is a
 * row of five steps with the tools loop under the agent and the revise loop under the draft and critic. The
 * narrow one is a column, with the tools loop beside the agent and the revise loop beside the critic, so a
 * phone shows the whole graph with its text at full size.
 */
export const LAYOUTS: Record<'wide' | 'narrow', Layout> = {
  wide: {
    view: { width: 880, height: 226 },
    boxes: {
      plan: box('plan', 10, 40, 124),
      agent: box('agent', 194, 40, 124),
      tools: box('tools', 194, 150, 124),
      draft: box('draft', 378, 40, 124),
      critic: box('critic', 562, 40, 124),
      final: box('final', 746, 40, 124),
    },
    edges: [
      { key: 'plan>agent', path: 'M134 72 H194', conditional: false },
      {
        key: 'agent>tools',
        path: 'M236 104 V150',
        conditional: true,
        label: { x: 226, y: 132, anchor: 'end', base: TOOLS_BASE },
      },
      { key: 'tools>agent', path: 'M276 150 V104', conditional: false },
      {
        key: 'agent>draft',
        path: 'M318 72 H378',
        conditional: true,
        label: { x: 348, y: 28, anchor: 'middle', base: 'draft' },
      },
      { key: 'draft>critic', path: 'M502 72 H562', conditional: false },
      {
        key: 'critic>final',
        path: 'M686 72 H746',
        conditional: true,
        label: { x: 716, y: 28, anchor: 'middle', base: 'final' },
      },
      {
        key: 'critic>draft',
        path: 'M648 104 C648 160 460 160 460 104',
        conditional: true,
        label: { x: 554, y: 180, anchor: 'middle', base: REVISE_BASE },
      },
    ],
    endPath: 'M808 104 V148',
    startLabel: { x: 72, y: 28 },
    endLabel: { x: 808, y: 166 },
  },
  narrow: {
    view: { width: 340, height: 500 },
    boxes: {
      plan: box('plan', 8, 30, 150),
      agent: box('agent', 8, 120, 150),
      tools: box('tools', 190, 120, 142),
      draft: box('draft', 8, 210, 150),
      critic: box('critic', 8, 300, 150),
      final: box('final', 8, 390, 150),
    },
    edges: [
      { key: 'plan>agent', path: 'M83 94 V120', conditional: false },
      {
        key: 'agent>tools',
        path: 'M158 142 H190',
        conditional: true,
        label: { x: 190, y: 110, anchor: 'start', base: TOOLS_BASE },
      },
      { key: 'tools>agent', path: 'M190 164 H158', conditional: false },
      {
        key: 'agent>draft',
        path: 'M83 184 V210',
        conditional: true,
        label: { x: 95, y: 202, anchor: 'start', base: 'draft' },
      },
      { key: 'draft>critic', path: 'M83 274 V300', conditional: false },
      {
        key: 'critic>final',
        path: 'M83 364 V390',
        conditional: true,
        label: { x: 95, y: 382, anchor: 'start', base: 'final' },
      },
      {
        key: 'critic>draft',
        path: 'M158 332 H184 V242 H158',
        conditional: true,
        label: { x: 194, y: 290, anchor: 'start', base: REVISE_BASE },
      },
    ],
    endPath: 'M83 454 V476',
    startLabel: { x: 83, y: 16 },
    endLabel: { x: 83, y: 492 },
  },
}

/** The wide drawing's edges, kept under the old name for the tests and the label helpers. */
export const EDGES: EdgeShape[] = LAYOUTS.wide.edges

/** The key the run view uses for the arrow from the final step to the end of the run. */
export const END_KEY = 'final>end'

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
