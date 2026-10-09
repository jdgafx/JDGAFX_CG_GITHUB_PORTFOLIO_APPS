import { useEffect, useRef, useState } from 'react'
import { milliseconds } from '../lib/format'
import { narrowLayout, takenEdges, wideLayout, type Mark, type Step } from '../lib/graphLayout'

const NODE_CLASS: Record<Mark, string> = {
  idle: '',
  active: 'ds-g-node--active',
  ok: 'ds-g-node--done',
  warn: 'ds-g-node--stopped',
  failed: 'ds-g-node--failed',
  skipped: 'ds-g-node--skipped',
  stopped: 'ds-g-node--stopped',
}

const DOT_CLASS: Record<Mark, string> = {
  idle: 'ds-g-dot--idle',
  active: 'ds-g-dot--active',
  ok: 'ds-g-dot--done',
  warn: 'ds-g-dot--stopped',
  failed: 'ds-g-dot--failed',
  skipped: 'ds-g-dot--skipped',
  stopped: 'ds-g-dot--stopped',
}

/** Below this stage width the column drawing is used, so the whole graph stays readable on a phone. */
const NARROW_BELOW = 720

const WIDE = wideLayout()
const NARROW = narrowLayout()

function useNarrow() {
  const ref = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? NARROW_BELOW) < NARROW_BELOW))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, narrow }
}

function Arrow({ id, taken }: { id: string; taken: boolean }) {
  return (
    <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path className={taken ? 'ds-g-arrow ds-g-arrow--taken' : 'ds-g-arrow'} d="M0 0 L10 5 L0 10 z" />
    </marker>
  )
}

interface GraphViewProps {
  steps: Step[]
}

/** The pipeline as a graph: five steps and the audit, with the hand-offs taken so far in the signal colour. */
export function GraphView({ steps }: GraphViewProps) {
  const { ref, narrow } = useNarrow()
  const layout = narrow ? NARROW : WIDE
  const taken = takenEdges(steps)
  const stepOf = (id: string) => steps.find(step => step.id === id)
  const path = steps.filter(step => step.mark !== 'idle' && step.mark !== 'skipped')

  return (
    <section className="ds-section ds-run__stage" aria-labelledby="graph-title">
      <div className="ds-section__head ds-section__head--row ds-section__head--bare">
        <h2 id="graph-title" className="ds-section__title">
          Pipeline
        </h2>
        <ul className="ds-legend" aria-label="Legend">
          <li>
            <span className="ds-dot ds-dot--skipped" aria-hidden="true" />
            waiting
          </li>
          <li>
            <span className="ds-dot ds-dot--running" aria-hidden="true" />
            working
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
            hand-off taken
          </li>
        </ul>
      </div>
      <div className="ds-stage" ref={ref}>
        <svg
          className={narrow ? 'graph-svg graph-svg--narrow' : 'graph-svg'}
          viewBox={`0 0 ${layout.view.width} ${layout.view.height}`}
          role="img"
          aria-label="Pipeline: retrieve sources, then the Researcher, Analyst, Critic and Synthesizer in order, then an audit of every cited sentence in the report."
        >
          <defs>
            <Arrow id="arrow" taken={false} />
            <Arrow id="arrow-taken" taken />
          </defs>
          {layout.edges.map((edge, i) => {
            const isTaken = taken[i] === true
            return (
              <g key={edge.from}>
                <path className={isTaken ? 'ds-g-edge ds-g-edge--taken' : 'ds-g-edge'} d={edge.path} markerEnd={isTaken ? 'url(#arrow-taken)' : 'url(#arrow)'} />
                <text className={isTaken ? 'ds-g-label ds-g-label--taken' : 'ds-g-label'} x={edge.labelAt.x} y={edge.labelAt.y} textAnchor={edge.labelAt.anchor}>
                  {edge.label}
                </text>
              </g>
            )
          })}
          {layout.boxes.map(box => {
            const step = stepOf(box.id)
            if (!step) return null
            return (
              <g key={box.id}>
                <title>{`${step.title}: ${step.word}`}</title>
                {step.mark === 'active' && <rect className="ds-g-halo" x={box.x - 6} y={box.y - 6} width={box.w + 12} height={box.h + 12} rx={12} />}
                <rect className={`ds-g-node ${NODE_CLASS[step.mark]}`} x={box.x} y={box.y} width={box.w} height={box.h} rx={8} />
                <text className="ds-g-title" x={box.x + 16} y={box.y + 27}>
                  {step.title}
                </text>
                <text className="ds-g-sub" x={box.x + 16} y={box.y + 45}>
                  {step.sub}
                </text>
                <circle className={`ds-g-dot ${DOT_CLASS[step.mark]}`} cx={box.x + 20} cy={box.y + 61} r={4.5} />
                <text className={step.mark === 'active' ? 'ds-g-state ds-g-state--active' : 'ds-g-state'} x={box.x + 32} y={box.y + 65}>
                  {step.word}
                </text>
                {step.ms !== undefined && (
                  <text className="ds-g-sub ds-g-ms" x={box.x + box.w - 16} y={box.y + 65} textAnchor="end">
                    {milliseconds(step.ms)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        {path.length > 0 && (
          <ol className="ds-path" aria-label="Steps reached, in order">
            {path.map(step => (
              <li key={step.id} className={step.mark === 'active' ? 'ds-path__now' : undefined}>
                {step.title}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
