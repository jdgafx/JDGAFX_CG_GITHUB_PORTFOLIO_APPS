import type { NodeName } from '../../netlify/shared/events'

/** The graph drawn as a column with a loop on each side. Units are SVG user units. */
export const VIEW = { width: 480, height: 456 }

export interface NodeBox {
  x: number
  y: number
  w: number
  h: number
  title: string
  sub: string
}

export const BOXES: Record<NodeName, NodeBox> = {
  plan: { x: 150, y: 24, w: 180, h: 48, title: 'plan', sub: 'search queries' },
  agent: { x: 150, y: 112, w: 180, h: 48, title: 'agent', sub: 'decides on tools' },
  tools: { x: 350, y: 112, w: 112, h: 48, title: 'tools', sub: 'Wikipedia' },
  draft: { x: 150, y: 200, w: 180, h: 48, title: 'draft', sub: 'cited answer' },
  critic: { x: 150, y: 288, w: 180, h: 48, title: 'critic', sub: 'accept or revise' },
  final: { x: 150, y: 376, w: 180, h: 48, title: 'final', sub: 'sources listed' },
}

export interface EdgeShape {
  /** "from>to", the key the run view uses for the labels taken. */
  key: string
  path: string
  conditional: boolean
  /** Where the label sits, and the text shown before any decision is taken. */
  label?: { x: number; y: number; anchor: 'start' | 'middle' | 'end'; base: string }
}

export const EDGES: EdgeShape[] = [
  { key: 'plan>agent', path: 'M240 72 V112', conditional: false },
  {
    key: 'agent>tools',
    path: 'M300 112 C300 80 406 80 406 112',
    conditional: true,
    label: { x: 353, y: 74, anchor: 'middle', base: 'tools' },
  },
  { key: 'tools>agent', path: 'M380 160 C380 186 300 186 300 160', conditional: false },
  {
    key: 'agent>draft',
    path: 'M240 160 V200',
    conditional: true,
    label: { x: 232, y: 184, anchor: 'end', base: 'draft' },
  },
  { key: 'draft>critic', path: 'M240 248 V288', conditional: false },
  {
    key: 'critic>final',
    path: 'M240 336 V376',
    conditional: true,
    label: { x: 232, y: 360, anchor: 'end', base: 'final' },
  },
  {
    key: 'critic>draft',
    path: 'M330 300 H440 V224 H330',
    conditional: true,
    label: { x: 385, y: 262, anchor: 'middle', base: 'revise' },
  },
]

/** The arrow from the final node to the end of the run. */
export const END_PATH = 'M240 424 V440'
