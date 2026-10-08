import type { NodeName } from '../../netlify/shared/events'
import { BOXES, EDGES, END_PATH, VIEW, type EdgeShape, type NodeBox } from '../lib/graphLayout'
import { NODES, type NodeMark, type RunView } from '../lib/runState'

const MARK_CLASS: Record<NodeMark, string> = {
  idle: '',
  active: 'graph-node--active',
  ok: 'graph-node--ok',
  failed: 'graph-node--failed',
  skipped: 'graph-node--skipped',
}

const MARK_WORD: Record<NodeMark, string> = {
  idle: 'not reached',
  active: 'running',
  ok: 'finished',
  failed: 'failed',
  skipped: 'skipped',
}

interface NodeShapeProps {
  name: NodeName
  box: NodeBox
  mark: NodeMark
}

function NodeShape({ name, box, mark }: NodeShapeProps) {
  const cx = box.x + box.w / 2
  return (
    <g>
      <title>{`${name}: ${MARK_WORD[mark]}`}</title>
      <rect className={`graph-node ${MARK_CLASS[mark]}`} x={box.x} y={box.y} width={box.w} height={box.h} rx={10} />
      <text className="graph-text" x={cx} y={box.y + box.h / 2 - 2} textAnchor="middle">
        {box.title}
      </text>
      <text className="graph-sub" x={cx} y={box.y + box.h / 2 + 14} textAnchor="middle">
        {box.sub}
      </text>
    </g>
  )
}

interface EdgeShapeProps {
  edge: EdgeShape
  taken: string | undefined
}

function EdgeView({ edge, taken }: EdgeShapeProps) {
  const classes = ['graph-edge']
  if (edge.conditional) classes.push('graph-edge--loop')
  if (taken !== undefined) classes.push('graph-edge--taken')
  return (
    <g>
      <path
        className={classes.join(' ')}
        d={edge.path}
        markerEnd={taken !== undefined ? 'url(#arrow-taken)' : 'url(#arrow)'}
      />
      {edge.label && (
        <text
          className={taken !== undefined ? 'graph-label graph-label--taken' : 'graph-label'}
          x={edge.label.x}
          y={edge.label.y}
          textAnchor={edge.label.anchor}
        >
          {taken ?? edge.label.base}
        </text>
      )}
    </g>
  )
}

interface GraphViewProps {
  view: RunView
}

export function GraphView({ view }: GraphViewProps) {
  const decisions = Object.entries(view.taken)
  return (
    <section className="ds-card" aria-labelledby="graph-title">
      <div className="ds-card__head">
        <h2 id="graph-title" className="ds-card__title">Graph</h2>
        <span className="ds-hint">The node running now is highlighted. Taken decisions are in accent.</span>
      </div>
      <svg
        className="graph-svg"
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label="Graph: plan, then an agent with a tools loop, then draft, critic and final. The critic can send the draft back."
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path className="graph-arrow" d="M0 0 L10 5 L0 10 z" />
          </marker>
          <marker id="arrow-taken" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path className="graph-arrow graph-arrow--taken" d="M0 0 L10 5 L0 10 z" />
          </marker>
        </defs>
        <text className="graph-sub" x={240} y={16} textAnchor="middle">
          start
        </text>
        {EDGES.map((edge) => (
          <EdgeView key={edge.key} edge={edge} taken={view.taken[edge.key]} />
        ))}
        <path className="graph-edge" d={END_PATH} markerEnd="url(#arrow)" />
        <text className="graph-sub" x={240} y={452} textAnchor="middle">
          end
        </text>
        {NODES.map((name) => (
          <NodeShape key={name} name={name} box={BOXES[name]} mark={view.marks[name]} />
        ))}
      </svg>
      {decisions.length > 0 && (
        <ul className="edge-log" aria-label="Decisions taken">
          {decisions.map(([key, label]) => (
            <li key={key}>{`${key.split('>')[0]}: ${label}`}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
