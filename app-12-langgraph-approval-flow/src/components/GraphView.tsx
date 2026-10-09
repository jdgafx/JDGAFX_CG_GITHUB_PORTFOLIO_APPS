import type { CSSProperties } from 'react'
import type { NodeStatus, RunView } from '../lib/run-state'
import type { NodeName } from '../types'

type Point = [number, number]
type ArrowName = 'start' | 'classifyDecide' | 'decideReview' | 'decideReply' | 'reviewReply' | 'end'

/** The stage has a fixed size, so the boxes and arrows keep their places. A narrow screen scrolls it. */
const STAGE = { width: 560, height: 226 }
const BOX = { width: 112, height: 76 }
const TOP_ROW = 12
const LOW_ROW = 116

const PLACE: Record<NodeName, { left: number; top: number }> = {
  classify: { left: 44, top: TOP_ROW },
  decide: { left: 196, top: TOP_ROW },
  review: { left: 196, top: LOW_ROW },
  reply: { left: 400, top: TOP_ROW },
}

/** Each arrow as its points. The last segment sets the direction of the arrowhead. */
const ARROWS: Record<ArrowName, Point[]> = {
  start: [[30, 50], [44, 50]],
  classifyDecide: [[156, 50], [196, 50]],
  decideReply: [[308, 50], [400, 50]],
  decideReview: [[252, 88], [252, 116]],
  reviewReply: [[308, 154], [456, 154], [456, 88]],
  end: [[512, 50], [534, 50]],
}

const STATE_TEXT: Record<NodeStatus, string> = {
  idle: 'not run',
  running: 'running',
  waiting: 'paused',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
}

/** The dot beside each state. The word is always shown too, so no state rests on colour alone. */
const DOT_CLASS: Record<NodeStatus, string> = {
  idle: '',
  running: 'ds-dot--running',
  waiting: 'gg-dot--waiting',
  done: 'ds-dot--ok',
  failed: 'ds-dot--failed',
  skipped: 'ds-dot--skipped',
}

function lineOf(points: readonly Point[]): string {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
}

/** A filled arrowhead at the last point, pointing along the last segment. */
function headOf(points: readonly Point[]): string {
  const [x1, y1] = points[points.length - 1]
  const [x0, y0] = points[points.length - 2]
  const dx = Math.sign(x1 - x0)
  const dy = Math.sign(y1 - y0)
  const baseX = x1 - dx * 7
  const baseY = y1 - dy * 7
  const spreadX = -dy * 4
  const spreadY = dx * 4
  return `M${x1} ${y1} L${baseX + spreadX} ${baseY + spreadY} L${baseX - spreadX} ${baseY - spreadY} Z`
}

function Arrow({ name, taken }: { name: ArrowName; taken: boolean }) {
  const points = ARROWS[name]
  return (
    <>
      <path className={taken ? 'gg-stage__line gg-stage__line--taken' : 'gg-stage__line'} d={lineOf(points)} />
      <path className={taken ? 'gg-stage__head gg-stage__head--taken' : 'gg-stage__head'} d={headOf(points)} />
    </>
  )
}

function StepBox({ name, status }: { name: NodeName; status: NodeStatus }) {
  const place = PLACE[name]
  return (
    <li
      className={`gg-node gg-node--${status}`}
      style={{ left: place.left, top: place.top, width: BOX.width, height: BOX.height }}
    >
      <span className="gg-node__head">
        <span className="gg-node__name">{name}</span>
        {status === 'waiting' ? <span className="gg-node__pause" aria-hidden="true" /> : <span className={`ds-dot ${DOT_CLASS[status]}`} aria-hidden="true" />}
      </span>
      <span className="gg-node__state">{STATE_TEXT[status]}</span>
    </li>
  )
}

/** A conditional edge's label, always shown. A taken label is in the signal colour, and the hidden text says which. */
function EdgeLabel({ text, taken, style }: { text: string; taken: boolean; style: CSSProperties }) {
  return (
    <span className={taken ? 'gg-stage__label gg-stage__label--taken' : 'gg-stage__label'} style={style}>
      {text}
      <span className="visually-hidden">{taken ? ', taken' : ', not taken'}</span>
    </span>
  )
}

/** The run as a graph: four steps, the two decide edges with their labels, and the path this run took. */
export function GraphView({ run }: { run: RunView }) {
  const taken = (key: string) => key in run.taken
  const needsHuman = taken('decide>review')
  const autoTriage = taken('decide>reply')
  const paused = run.nodes.review === 'waiting'

  return (
    <section className="ds-panel gg-hero" aria-labelledby="graph-heading">
      <div className="ds-section__head">
        <h2 id="graph-heading" className="ds-section__title">Graph</h2>
        <p className="ds-section__sub">
          Each box is one step. The highlighted path is the route this run took. The review box is where it waits for a maintainer.
        </p>
      </div>
      <p className="ds-help gg-scroll-hint">Swipe the graph sideways to see all of it.</p>
      <div className="ds-scroll-x" role="region" aria-label="Graph, scrolls sideways" tabIndex={0}>
        <div className="gg-stage" style={{ width: STAGE.width, height: STAGE.height }}>
          <svg
            className="gg-stage__svg"
            width={STAGE.width}
            height={STAGE.height}
            viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}
            aria-hidden="true"
            focusable="false"
          >
            <Arrow name="start" taken={run.nodes.classify !== 'idle'} />
            <Arrow name="classifyDecide" taken={taken('classify>decide')} />
            <Arrow name="decideReview" taken={needsHuman} />
            <Arrow name="decideReply" taken={autoTriage} />
            <Arrow name="reviewReply" taken={taken('review>reply')} />
            <Arrow name="end" taken={run.nodes.reply === 'done'} />
          </svg>
          <ol className="gg-stage__nodes" aria-label="Graph steps">
            <StepBox name="classify" status={run.nodes.classify} />
            <StepBox name="decide" status={run.nodes.decide} />
            <StepBox name="review" status={run.nodes.review} />
            <StepBox name="reply" status={run.nodes.reply} />
          </ol>
          <EdgeLabel text="auto-triage" taken={autoTriage} style={{ left: 316, top: 30 }} />
          <EdgeLabel text="needs a maintainer" taken={needsHuman} style={{ left: 262, top: 94 }} />
          <span className="gg-stage__terminal" style={{ left: 0, top: 42 }}>
            Start
          </span>
          <span className="gg-stage__terminal" style={{ left: 538, top: 42 }}>
            End
          </span>
          {paused ? (
            <span className="gg-stage__pause" style={{ left: 168, top: 198 }}>
              Paused for a maintainer
            </span>
          ) : null}
        </div>
      </div>
    </section>
  )
}
