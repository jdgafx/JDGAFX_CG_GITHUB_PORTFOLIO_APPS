import { useEffect, useRef, useState } from 'react'
import type { NodeName } from '../../netlify/shared/events'
import {
  LAYOUTS,
  END_KEY,
  labelText,
  shownMark,
  traversedEdges,
  type EdgeShape,
  type NodeBox,
} from '../lib/graphLayout'
import { NODES, type NodeMark, type RunView } from '../lib/runState'

const MARK_CLASS: Record<NodeMark, string> = {
  idle: '',
  active: 'ds-g-node--active',
  ok: 'ds-g-node--done',
  failed: 'ds-g-node--failed',
  skipped: 'ds-g-node--skipped',
  stopped: 'ds-g-node--stopped',
}

const MARK_DOT: Record<NodeMark, string> = {
  idle: 'ds-g-dot--idle',
  active: 'ds-g-dot--active',
  ok: 'ds-g-dot--done',
  failed: 'ds-g-dot--failed',
  skipped: 'ds-g-dot--skipped',
  stopped: 'ds-g-dot--stopped',
}

const MARK_WORD: Record<NodeMark, string> = {
  idle: 'not run yet',
  active: 'running',
  ok: 'finished',
  failed: 'failed',
  skipped: 'skipped',
  stopped: 'stopped',
}

/** Below this stage width the column drawing is used, so the whole graph stays readable on a phone. */
const NARROW_BELOW = 720

function join(...parts: string[]): string {
  return parts.filter((part) => part !== '').join(' ')
}

function edgeClass(conditional: boolean, taken: boolean, skipped = false): string {
  return join(
    'ds-g-edge',
    conditional ? 'ds-g-edge--loop' : '',
    taken ? 'ds-g-edge--taken' : '',
    skipped ? 'ds-g-edge--skipped' : '',
  )
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
        <rect className="ds-g-halo" x={box.x - 6} y={box.y - 6} width={box.w + 12} height={box.h + 12} rx={12} />
      )}
      <rect className={join('ds-g-node', MARK_CLASS[mark])} x={box.x} y={box.y} width={box.w} height={box.h} rx={8} />
      <text className="ds-g-title" x={box.x + 14} y={box.y + 23}>
        {box.title}
      </text>
      <text className="ds-g-sub" x={box.x + 14} y={box.y + 40}>
        {box.sub}
      </text>
      <circle className={join('ds-g-dot', MARK_DOT[mark])} cx={box.x + 18} cy={box.y + 52} r={4.5} />
      <text
        className={mark === 'active' ? 'ds-g-state ds-g-state--active' : 'ds-g-state'}
        x={box.x + 28}
        y={box.y + 56}
      >
        {word}
      </text>
    </g>
  )
}

interface EdgeViewProps {
  edge: EdgeShape
  taken: boolean
  skipped: boolean
  text: string | undefined
}

function EdgeView({ edge, taken, skipped, text }: EdgeViewProps) {
  return (
    <g>
      <path className={edgeClass(edge.conditional, taken, skipped)} d={edge.path} markerEnd={markerFor(taken)} />
      {edge.label && text !== undefined && (
        <text
          className={taken ? 'ds-g-label ds-g-label--taken' : 'ds-g-label'}
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

/** True while the stage is narrower than the wide drawing needs. */
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

interface GraphViewProps {
  view: RunView
}

export function GraphView({ view }: GraphViewProps) {
  const { ref, narrow } = useNarrow()
  const layout = LAYOUTS[narrow ? 'narrow' : 'wide']
  const traversed = traversedEdges(view.trace)
  // A step that was skipped never ran, so the edges around it are not drawn as the path taken.
  const skippedNodes = new Set(NODES.filter((name) => shownMark(name, view.marks, view.trace) === 'skipped'))
  const touchesSkipped = (key: string) => key.split('>').some((name) => skippedNodes.has(name as NodeName))
  const isTaken = (key: string) => !touchesSkipped(key) && (traversed.has(key) || view.taken[key] !== undefined)
  const endTaken = isTaken(END_KEY)

  return (
    <section className="ds-section ds-run__stage" aria-labelledby="graph-title">
      <div className="ds-section__head ds-section__head--row ds-section__head--bare">
        <h2 id="graph-title" className="ds-section__title">
          Graph
        </h2>
        <ul className="ds-legend" aria-label="Legend">
          <li>
            <span className="ds-dot ds-dot--skipped" aria-hidden="true" />
            waiting
          </li>
          <li>
            <span className="ds-dot ds-dot--running" aria-hidden="true" />
            running
          </li>
          <li>
            <span className="ds-dot ds-dot--ok" aria-hidden="true" />
            finished
          </li>
          <li>
            <span className="ds-dot ds-dot--failed" aria-hidden="true" />
            failed
          </li>
          <li>
            <span className="ds-legend__edge" aria-hidden="true" />
            path taken
          </li>
        </ul>
      </div>
      <div className="ds-stage" ref={ref}>
        <svg
          className={narrow ? 'graph-svg graph-svg--narrow' : 'graph-svg'}
          viewBox={`0 0 ${layout.view.width} ${layout.view.height}`}
          role="img"
          aria-label="Graph: plan, then an agent with a tools loop, then draft, critic and final. The critic can send the draft back."
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path className="ds-g-arrow" d="M0 0 L10 5 L0 10 z" />
            </marker>
            <marker
              id="arrow-taken"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path className="ds-g-arrow ds-g-arrow--taken" d="M0 0 L10 5 L0 10 z" />
            </marker>
          </defs>
          <text className="ds-g-sub" x={layout.startLabel.x} y={layout.startLabel.y} textAnchor="middle">
            start
          </text>
          {layout.edges.map((edge) => (
            <EdgeView
              key={edge.key}
              edge={edge}
              taken={isTaken(edge.key)}
              skipped={touchesSkipped(edge.key)}
              text={labelText(edge, view.taken)}
            />
          ))}
          <path className={edgeClass(false, endTaken)} d={layout.endPath} markerEnd={markerFor(endTaken)} />
          <text className="ds-g-sub" x={layout.endLabel.x} y={layout.endLabel.y} textAnchor="middle">
            end
          </text>
          {NODES.map((name) => (
            <NodeShape key={name} name={name} box={layout.boxes[name]} mark={shownMark(name, view.marks, view.trace)} />
          ))}
        </svg>
        {view.trace.some((entry) => entry.status !== 'skipped') && (
          <ol className="ds-path" aria-label="Steps taken, in order">
            {view.trace
              .filter((entry) => entry.status !== 'skipped')
              .map((entry) => (
                <li key={entry.key} className={entry.status === 'running' ? 'ds-path__now' : undefined}>
                  {entry.node}
                </li>
              ))}
          </ol>
        )}
      </div>
    </section>
  )
}
