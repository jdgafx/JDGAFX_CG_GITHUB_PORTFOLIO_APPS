import { useEffect, useRef, useState } from 'react'
import { graphLayout, type Box } from '../lib/graphLayout'
import type { NodeStatus, RunView } from '../lib/run-state'
import type { NodeName } from '../types'

/** Below this stage width the column drawing is used, so the whole graph stays readable on a phone. */
const NARROW_BELOW = 720

const TITLE: Record<NodeName, string> = { classify: 'classify', duplicates: 'duplicates', decide: 'decide', review: 'review', reply: 'reply' }

const WORD: Record<NodeStatus, string> = {
  idle: 'not run',
  running: 'running',
  waiting: 'paused',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
}
const NODE_CLASS: Record<NodeStatus, string> = {
  idle: '',
  running: 'ds-g-node--active',
  waiting: 'ds-g-node--paused',
  done: 'ds-g-node--done',
  failed: 'ds-g-node--failed',
  skipped: 'ds-g-node--skipped',
}
const DOT_CLASS: Record<NodeStatus, string> = {
  idle: 'ds-g-dot--idle',
  running: 'ds-g-dot--active',
  waiting: 'ds-g-dot--paused',
  done: 'ds-g-dot--done',
  failed: 'ds-g-dot--failed',
  skipped: 'ds-g-dot--idle',
}

const join = (...parts: string[]): string => parts.filter((part) => part !== '').join(' ')

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

function Node({ box, name, status }: { box: Box; name: NodeName; status: NodeStatus }) {
  return (
    <g>
      {status === 'running' && <rect className="ds-g-halo" x={box.x - 5} y={box.y - 5} width={box.w + 10} height={box.h + 10} rx={11} />}
      <rect className={join('ds-g-node', NODE_CLASS[status])} x={box.x} y={box.y} width={box.w} height={box.h} rx={8} />
      <text className="ds-g-title" x={box.x + 12} y={box.y + 22}>
        {TITLE[name]}
      </text>
      <circle className={join('ds-g-dot', DOT_CLASS[status])} cx={box.x + 16} cy={box.y + 39} r={4.5} />
      <text className={status === 'running' ? 'ds-g-state ds-g-state--active' : 'ds-g-state'} x={box.x + 26} y={box.y + 43}>
        {WORD[status]}
      </text>
    </g>
  )
}

/** The route this run took, as words, for a reader who cannot see the drawing. */
function pathSteps(run: RunView): string[] {
  const steps: string[] = []
  for (const name of ['classify', 'duplicates', 'decide', 'review', 'reply'] as const) {
    const status = run.nodes[name]
    if (status === 'idle') continue
    steps.push(status === 'skipped' ? `${name} (skipped)` : status === 'waiting' ? `${name} (paused)` : name)
  }
  return steps
}

/** The run as a graph: five steps, the two edges out of decide with their labels, and the path this run took. */
export function GraphView({ run }: { run: RunView }) {
  const { ref, narrow } = useNarrow()
  const layout = graphLayout(narrow)
  const taken = (key: string) => key in run.taken
  const reviewSkipped = run.nodes.review === 'skipped'
  const steps = pathSteps(run)

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
            <span className="ds-dot ds-dot--paused" aria-hidden="true" />
            paused
          </li>
          <li>
            <span className="ds-dot ds-dot--ok" aria-hidden="true" />
            done
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
          className={narrow ? 'gg-graph gg-graph--narrow' : 'gg-graph'}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="Graph: classify the issue, search the repository for duplicates, decide by rules, then either pause for a maintainer at review or go straight to the reply draft."
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path className="ds-g-arrow" d="M0 0 L10 5 L0 10 z" />
            </marker>
            <marker id="arrow-taken" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path className="ds-g-arrow ds-g-arrow--taken" d="M0 0 L10 5 L0 10 z" />
            </marker>
          </defs>
          {layout.edges.map((edge) => {
            const on = taken(edge.key)
            const skipped = reviewSkipped && edge.key.includes('review')
            return (
              <path
                key={edge.key}
                className={join('ds-g-edge', on ? 'ds-g-edge--taken' : '', skipped ? 'ds-g-edge--skipped' : '')}
                d={edge.path}
                markerEnd={on ? 'url(#arrow-taken)' : 'url(#arrow)'}
              />
            )
          })}
          {layout.labels.map((label) => (
            <text key={label.edge} className={taken(label.edge) ? 'ds-g-label ds-g-label--taken' : 'ds-g-label'} x={label.x} y={label.y}>
              {label.text}
            </text>
          ))}
          {(Object.keys(layout.nodes) as NodeName[]).map((name) => (
            <Node key={name} box={layout.nodes[name]} name={name} status={run.nodes[name]} />
          ))}
        </svg>
        {steps.length > 0 && (
          <ol className="ds-path" aria-label="Steps taken, in order">
            {steps.map((step, i) => (
              <li key={step} className={i === steps.length - 1 && run.nodes.review === 'waiting' ? 'ds-path__now' : undefined}>
                {step}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
