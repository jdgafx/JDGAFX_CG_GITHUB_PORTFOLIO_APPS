import type { NodeName } from '../../netlify/shared/events'
import {
  BOXES,
  EDGES,
  END_KEY,
  END_LABEL,
  END_PATH,
  START_LABEL,
  VIEW,
  displayLabel,
  labelText,
  shownMark,
  traversedEdges,
  type EdgeShape,
  type NodeBox,
} from '../lib/graphLayout'
import { NODES, type NodeMark, type RunView } from '../lib/runState'

const MARK_CLASS: Record<NodeMark, string> = {
  idle: '',
  active: 'graph-node--active',
  ok: '',
  failed: 'graph-node--failed',
  skipped: 'graph-node--skipped',
  stopped: 'graph-node--stopped',
}

const MARK_DOT: Record<NodeMark, string> = {
  idle: 'graph-dot--idle',
  active: 'graph-dot--active',
  ok: 'graph-dot--ok',
  failed: 'graph-dot--failed',
  skipped: 'graph-dot--skipped',
  stopped: 'graph-dot--stopped',
}

const MARK_WORD: Record<NodeMark, string> = {
  idle: 'not run yet',
  active: 'running',
  ok: 'finished',
  failed: 'failed',
  skipped: 'skipped',
  stopped: 'stopped',
}

function join(...parts: string[]): string {
  return parts.filter((part) => part !== '').join(' ')
}

function edgeClass(conditional: boolean, taken: boolean): string {
  return join('graph-edge', conditional ? 'graph-edge--loop' : '', taken ? 'graph-edge--taken' : '')
}

function markerFor(taken: boolean): string {
  return taken ? 'url(#arrow-taken)' : 'url(#arrow)'
}

interface NodeShapeProps {
  name: NodeName
  box: NodeBox
  mark: NodeMark
}

function NodeShape({ name, box, mark }: NodeShapeProps) {
  const word = MARK_WORD[mark]
  return (
    <g>
      <title>{`${name}: ${word}`}</title>
      {mark === 'active' && (
        <rect className="graph-halo" x={box.x - 6} y={box.y - 6} width={box.w + 12} height={box.h + 12} rx={12} />
      )}
      <rect className={join('graph-node', MARK_CLASS[mark])} x={box.x} y={box.y} width={box.w} height={box.h} rx={8} />
      <text className="graph-title" x={box.x + 14} y={box.y + 21}>
        {box.title}
      </text>
      <text className="graph-sub" x={box.x + 14} y={box.y + 37}>
        {box.sub}
      </text>
      <circle className={join('graph-dot', MARK_DOT[mark])} cx={box.x + 18} cy={box.y + 49} r={4.5} />
      <text className={mark === 'active' ? 'graph-state graph-state--active' : 'graph-state'} x={box.x + 28} y={box.y + 53}>
        {word}
      </text>
    </g>
  )
}

interface EdgeViewProps {
  edge: EdgeShape
  taken: boolean
  text: string | undefined
}

function EdgeView({ edge, taken, text }: EdgeViewProps) {
  return (
    <g>
      <path className={edgeClass(edge.conditional, taken)} d={edge.path} markerEnd={markerFor(taken)} />
      {edge.label && text !== undefined && (
        <text
          className={taken ? 'graph-label graph-label--taken' : 'graph-label'}
          x={edge.label.x}
          y={edge.label.y}
          textAnchor={edge.label.anchor}
        >
          {text}
        </text>
      )}
    </g>
  )
}

interface GraphViewProps {
  view: RunView
}

export function GraphView({ view }: GraphViewProps) {
  const traversed = traversedEdges(view.trace)
  const isTaken = (key: string) => traversed.has(key) || view.taken[key] !== undefined
  const decisions = Object.entries(view.taken)
  const endTaken = isTaken(END_KEY)

  return (
    <section className="ds-section" aria-labelledby="graph-title">
      <div className="ds-section__head">
        <h2 id="graph-title" className="ds-section__title">
          Graph
        </h2>
        <p className="ds-section__sub">Each box is one step. Arrows the run took are in signal colour.</p>
      </div>
      <div className="ds-panel graph-panel">
        <div className="ds-scroll-x">
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
            <text className="graph-sub" x={START_LABEL.x} y={START_LABEL.y} textAnchor="middle">
              start
            </text>
            {EDGES.map((edge) => (
              <EdgeView key={edge.key} edge={edge} taken={isTaken(edge.key)} text={labelText(edge, view.taken)} />
            ))}
            <path className={edgeClass(false, endTaken)} d={END_PATH} markerEnd={markerFor(endTaken)} />
            <text className="graph-sub" x={END_LABEL.x} y={END_LABEL.y} textAnchor="middle">
              end
            </text>
            {NODES.map((name) => (
              <NodeShape key={name} name={name} box={BOXES[name]} mark={shownMark(name, view.marks, view.trace)} />
            ))}
          </svg>
        </div>
        <p className="ds-help graph-hint">Swipe sideways to see the tools loop on the right.</p>
        {decisions.length > 0 && (
          <ul className="edge-log" aria-label="Decisions taken">
            {decisions.map(([key, label]) => (
              <li key={key}>{`${key.split('>')[0]}: ${displayLabel(label)}`}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
