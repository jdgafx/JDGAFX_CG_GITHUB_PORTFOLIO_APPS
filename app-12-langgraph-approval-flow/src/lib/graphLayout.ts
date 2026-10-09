import type { NodeName } from '../types'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Edge {
  /** "from>to", the key the page looks up in the run's taken edges. */
  key: string
  path: string
}

export interface Label {
  x: number
  y: number
  text: string
  /** The edge it names, so a label can be drawn as taken. */
  edge: string
}

export interface GraphLayout {
  width: number
  height: number
  nodes: Record<NodeName, Box>
  edges: Edge[]
  labels: Label[]
}

const W = 128
const H = 56

/** Wide drawing: four steps in a row, review under decide, the maintainer's way back up into reply. */
function wide(): GraphLayout {
  const top = 28
  const nodes = {
    classify: { x: 8, y: top, w: W, h: H },
    duplicates: { x: 176, y: top, w: W, h: H },
    decide: { x: 344, y: top, w: W, h: H },
    review: { x: 344, y: top + 104, w: W, h: H },
    reply: { x: 600, y: top, w: W, h: H },
  }
  const mid = (box: Box) => box.y + box.h / 2
  return {
    width: 736,
    height: top + 104 + H + 12,
    nodes,
    edges: [
      { key: 'classify>duplicates', path: `M${nodes.classify.x + W} ${mid(nodes.classify)} H${nodes.duplicates.x - 2}` },
      { key: 'duplicates>decide', path: `M${nodes.duplicates.x + W} ${mid(nodes.duplicates)} H${nodes.decide.x - 2}` },
      { key: 'decide>reply', path: `M${nodes.decide.x + W} ${mid(nodes.decide)} H${nodes.reply.x - 2}` },
      { key: 'decide>review', path: `M${nodes.decide.x + W / 2} ${top + H} V${nodes.review.y - 2}` },
      { key: 'review>reply', path: `M${nodes.review.x + W} ${mid(nodes.review)} H${nodes.reply.x + W / 2} V${top + H + 2}` },
    ],
    labels: [
      { x: 486, y: top + H / 2 - 8, text: 'auto-triage', edge: 'decide>reply' },
      { x: 420, y: top + H + 30, text: 'needs a maintainer', edge: 'decide>review' },
    ],
  }
}

/** Narrow drawing for a phone: one column, and the auto-triage edge runs down the right side past review. */
function narrow(): GraphLayout {
  const gap = 36
  const boxW = 150
  const ys = [8, 8 + H + gap, 8 + 2 * (H + gap), 8 + 3 * (H + gap), 8 + 4 * (H + gap)]
  const nodes = {
    classify: { x: 8, y: ys[0], w: boxW, h: H },
    duplicates: { x: 8, y: ys[1], w: boxW, h: H },
    decide: { x: 8, y: ys[2], w: boxW, h: H },
    review: { x: 8, y: ys[3], w: boxW, h: H },
    reply: { x: 8, y: ys[4], w: boxW, h: H },
  }
  const mid = 8 + boxW / 2
  const rightX = 8 + boxW + 56
  return {
    width: 340,
    height: ys[4] + H + 8,
    nodes,
    edges: [
      { key: 'classify>duplicates', path: `M${mid} ${ys[0] + H} V${ys[1] - 2}` },
      { key: 'duplicates>decide', path: `M${mid} ${ys[1] + H} V${ys[2] - 2}` },
      { key: 'decide>review', path: `M${mid} ${ys[2] + H} V${ys[3] - 2}` },
      { key: 'review>reply', path: `M${mid} ${ys[3] + H} V${ys[4] - 2}` },
      { key: 'decide>reply', path: `M${8 + boxW} ${ys[2] + H / 2} H${rightX} V${ys[4] + H / 2} H${8 + boxW + 2}` },
    ],
    labels: [
      { x: mid + 10, y: ys[2] + H + 22, text: 'needs a maintainer', edge: 'decide>review' },
      { x: rightX + 8, y: ys[3] + H / 2 + 4, text: 'auto-triage', edge: 'decide>reply' },
    ],
  }
}

export function graphLayout(isNarrow: boolean): GraphLayout {
  return isNarrow ? narrow() : wide()
}
