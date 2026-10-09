import { useEffect, useRef, useState } from 'react'
import { formatMs } from '../lib/format'
import type { PipelineView, StageState, StageView } from '../lib/pipeline'

const WORD: Record<StageState, string> = {
  waiting: 'Waiting',
  running: 'Running',
  ok: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  notrun: 'Not run',
}
const NODE: Record<StageState, string> = {
  waiting: '',
  running: ' ds-g-node--active',
  ok: ' ds-g-node--done',
  failed: ' ds-g-node--failed',
  skipped: ' ds-g-node--skipped',
  notrun: ' ds-g-node--skipped',
}
const DOT: Record<StageState, string> = {
  waiting: 'ds-g-dot--idle',
  running: 'ds-g-dot--active',
  ok: 'ds-g-dot--done',
  failed: 'ds-g-dot--failed',
  skipped: 'ds-g-dot--skipped',
  notrun: 'ds-g-dot--skipped',
}

/** Below this stage width the column drawing is used, so the whole graph stays readable on a phone. */
const NARROW_BELOW = 720

interface Box {
  x: number
  y: number
  w: number
  h: number
}
const WIDE = { width: 720, height: 112, boxes: [0, 270, 540].map((x): Box => ({ x, y: 8, w: 180, h: 92 })) }
const TALL = { width: 340, height: 388, boxes: [0, 148, 296].map((y): Box => ({ x: 0, y, w: 340, h: 92 })) }

function useNarrow() {
  const ref = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < NARROW_BELOW))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, narrow }
}

function Node({ box, title, sub, stage }: { box: Box; title: string; sub: string; stage: StageView }) {
  return (
    <g>
      {stage.state === 'running' && <rect className="ds-g-halo" x={box.x - 5} y={box.y - 5} width={box.w + 10} height={box.h + 10} rx={11} />}
      <rect className={`ds-g-node${NODE[stage.state]}`} x={box.x} y={box.y} width={box.w} height={box.h} rx={8} />
      <text className="ds-g-title" x={box.x + 12} y={box.y + 26}>
        {title}
      </text>
      <text className="ds-g-sub" x={box.x + 12} y={box.y + 47}>
        {sub}
      </text>
      <circle className={`ds-g-dot ${DOT[stage.state]}`} cx={box.x + 16} cy={box.y + 70} r={4.5} />
      <text className={stage.state === 'running' ? 'ds-g-state ds-g-state--active' : 'ds-g-state'} x={box.x + 26} y={box.y + 74}>
        {WORD[stage.state]}
        {stage.ms !== undefined ? `, ${formatMs(stage.ms)}` : ''}
      </text>
    </g>
  )
}

interface PipelineProps {
  view: PipelineView
  model: string | undefined
}

export default function Pipeline({ view, model }: PipelineProps) {
  const { ref, narrow } = useNarrow()
  const layout = narrow ? TALL : WIDE
  const [a, b, c] = layout.boxes
  const edge = (from: Box, to: Box) =>
    narrow ? `M${from.x + 40} ${from.y + from.h} V${to.y - 3}` : `M${from.x + from.w} ${from.y + from.h / 2} H${to.x - 3}`
  const labelAt = (from: Box, to: Box) =>
    narrow ? { x: from.x + 52, y: (from.y + from.h + to.y) / 2 + 5, anchor: 'start' as const } : { x: (from.x + from.w + to.x) / 2, y: from.y + from.h / 2 - 8, anchor: 'middle' as const }
  const first = labelAt(a, b)
  const second = labelAt(b, c)
  const thinkSub = model ? model.replace(/^anthropic\//, '') : 'Chat model, streaming'
  return (
    <section className="ds-section ds-run__stage" aria-labelledby="pipeline-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="pipeline-title" className="ds-section__title">
          Listen, think, speak
        </h2>
        <p className="ds-section__sub">Each question passes these stages. Think and Speak overlap: the voice starts while the model is still writing.</p>
      </div>
      <div className="ds-stage" ref={ref}>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="Three stages: Listen turns speech into a transcript, Think streams the reply, Speak reads it aloud."
        >
          <defs>
            <marker id="vox-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path className="ds-g-arrow" d="M0 0 L10 5 L0 10 z" />
            </marker>
            <marker id="vox-arrow-taken" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path className="ds-g-arrow ds-g-arrow--taken" d="M0 0 L10 5 L0 10 z" />
            </marker>
          </defs>
          <path className={view.transcriptPassed ? 'ds-g-edge ds-g-edge--taken' : 'ds-g-edge'} d={edge(a, b)} markerEnd={`url(#vox-arrow${view.transcriptPassed ? '-taken' : ''})`} />
          <path className={view.replyPassed ? 'ds-g-edge ds-g-edge--taken' : 'ds-g-edge'} d={edge(b, c)} markerEnd={`url(#vox-arrow${view.replyPassed ? '-taken' : ''})`} />
          <text className={view.transcriptPassed ? 'ds-g-label ds-g-label--taken' : 'ds-g-label'} x={first.x} y={first.y} textAnchor={first.anchor}>
            transcript
          </text>
          <text className={view.replyPassed ? 'ds-g-label ds-g-label--taken' : 'ds-g-label'} x={second.x} y={second.y} textAnchor={second.anchor}>
            sentences
          </text>
          <Node box={a} title="Listen" sub={view.listen.note ? 'Typed question' : 'Deepgram nova-3'} stage={view.listen} />
          <Node box={b} title="Think" sub={thinkSub} stage={view.think} />
          <Node box={c} title="Speak" sub="Browser voice" stage={view.speak} />
        </svg>
      </div>
    </section>
  )
}
