import type { StageName } from './view'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Edge {
  /** "split>fan", "fan:3>reduce", "reduce>synthesize" and so on: the key the page looks up to colour the path taken. */
  key: string
  path: string
}

export interface GraphLayout {
  width: number
  height: number
  stages: Record<StageName, Box>
  /** One box per chunk, in chunk order. */
  pills: Array<Box & { chunk: number }>
  fan: Box
  /** True when the fan is drawn as one block (two columns, or a phone) instead of a line to every chunk. */
  block: boolean
  edges: Edge[]
  fanLabel: { x: number; y: number; anchor: 'start' | 'middle' }
  loop: { path: string; label: { x: number; y: number; anchor: 'start' | 'middle' } }
}

const STAGE_H = 56
const PILL_H = 46
const GAP = 8
const STAGES: StageName[] = ['reduce', 'synthesize', 'check', 'final']

const stageWidth = (name: StageName): number => ({ split: 100, reduce: 108, synthesize: 124, check: 104, final: 96 })[name]

function pillBoxes(count: number, cols: number, pillW: number, left: number, top: number): GraphLayout['pills'] {
  return Array.from({ length: count }, (_, i) => ({
    chunk: i + 1,
    x: left + (i % cols) * (pillW + GAP),
    y: top + Math.floor(i / cols) * (PILL_H + GAP),
    w: pillW,
    h: PILL_H,
  }))
}

/** Wide drawing: a row of steps, the chunks as a column (two columns above six chunks), the loop under the row. */
function wide(count: number): GraphLayout {
  const cols = count > 6 ? 2 : 1
  const pillW = cols === 2 ? 100 : 116
  const rows = Math.ceil(count / cols)
  const fanW = cols * pillW + (cols - 1) * GAP
  const fanH = rows * PILL_H + (rows - 1) * GAP
  const top = 30
  const band = Math.max(fanH, STAGE_H)
  const midY = top + band / 2
  const stageY = midY - STAGE_H / 2
  const split: Box = { x: 8, y: stageY, w: stageWidth('split'), h: STAGE_H }
  const fan: Box = { x: split.x + split.w + 56, y: midY - fanH / 2, w: fanW, h: fanH }
  const stages = { split } as Record<StageName, Box>
  let x = fan.x + fan.w + 56
  for (const name of STAGES) {
    stages[name] = { x, y: stageY, w: stageWidth(name), h: STAGE_H }
    x += stageWidth(name) + 36
  }
  const pills = pillBoxes(count, cols, pillW, fan.x, fan.y)
  const block = cols === 2
  const edges: Edge[] = []
  if (block) {
    edges.push({ key: 'split>fan', path: `M${split.x + split.w} ${midY} H${fan.x - 2}` })
    edges.push({ key: 'fan>reduce', path: `M${fan.x + fan.w} ${midY} H${stages.reduce.x - 2}` })
  } else {
    for (const p of pills) {
      const cy = p.y + p.h / 2
      edges.push({ key: `split>fan:${p.chunk}`, path: `M${split.x + split.w} ${midY} C${split.x + split.w + 28} ${midY} ${p.x - 28} ${cy} ${p.x - 2} ${cy}` })
      edges.push({ key: `fan:${p.chunk}>reduce`, path: `M${p.x + p.w} ${cy} C${p.x + p.w + 28} ${cy} ${stages.reduce.x - 30} ${midY} ${stages.reduce.x - 2} ${midY}` })
    }
  }
  let prev: StageName = 'reduce'
  for (const name of STAGES.slice(1)) {
    edges.push({ key: `${prev}>${name}`, path: `M${stages[prev].x + stages[prev].w} ${midY} H${stages[name].x - 2}` })
    prev = name
  }
  const checkMid = stages.check.x + stages.check.w / 2
  const loopY = top + band + 34
  const fanMid = fan.x + fan.w / 2
  return {
    width: stages.final.x + stages.final.w + 8,
    height: loopY + 34,
    stages,
    pills,
    fan,
    block,
    edges,
    fanLabel: { x: fanMid, y: top - 10, anchor: 'middle' },
    loop: {
      path: `M${checkMid} ${stages.check.y + STAGE_H} V${loopY} H${fanMid} V${fan.y + fan.h + 2}`,
      label: { x: (checkMid + fanMid) / 2, y: loopY + 22, anchor: 'middle' },
    },
  }
}

/** Narrow drawing for a phone: one column, the chunks as a block of three across, the loop up the right edge. */
function narrow(count: number): GraphLayout {
  const cols = 3
  const pillW = 102
  const rows = Math.ceil(count / cols)
  const fanH = rows * PILL_H + (rows - 1) * GAP
  const width = 340
  const boxW = 150
  const split: Box = { x: 8, y: 8, w: boxW, h: STAGE_H }
  const fan: Box = { x: 8, y: split.y + STAGE_H + 44, w: cols * pillW + (cols - 1) * GAP, h: fanH }
  const stages = { split } as Record<StageName, Box>
  let y = fan.y + fan.h + 36
  for (const name of STAGES) {
    stages[name] = { x: 8, y, w: boxW, h: STAGE_H }
    y += STAGE_H + 32
  }
  const mid = 8 + boxW / 2
  const edges: Edge[] = [
    { key: 'split>fan', path: `M${mid} ${split.y + STAGE_H} V${fan.y - 2}` },
    { key: 'fan>reduce', path: `M${mid} ${fan.y + fan.h} V${stages.reduce.y - 2}` },
  ]
  let prev: StageName = 'reduce'
  for (const name of STAGES.slice(1)) {
    edges.push({ key: `${prev}>${name}`, path: `M${mid} ${stages[prev].y + STAGE_H} V${stages[name].y - 2}` })
    prev = name
  }
  const loopX = width - 14
  return {
    width,
    height: stages.final.y + STAGE_H + 8,
    stages,
    pills: pillBoxes(count, cols, pillW, fan.x, fan.y),
    fan,
    block: true,
    edges,
    fanLabel: { x: mid + 12, y: split.y + STAGE_H + 28, anchor: 'start' },
    loop: {
      path: `M${8 + boxW} ${stages.check.y + STAGE_H / 2} H${loopX} V${fan.y + fan.h + 2}`,
      label: { x: 8 + boxW + 14, y: stages.check.y + STAGE_H / 2 - 8, anchor: 'start' },
    },
  }
}

/** The drawing for `count` chunks, in units the page scales to the stage. At least one chunk is drawn. */
export function graphLayout(count: number, isNarrow: boolean): GraphLayout {
  const n = Math.max(1, Math.min(count, 12))
  return isNarrow ? narrow(n) : wide(n)
}
