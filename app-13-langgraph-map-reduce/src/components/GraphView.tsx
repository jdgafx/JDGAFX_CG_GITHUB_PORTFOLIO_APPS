import { useEffect, useRef, useState } from 'react'
import { graphLayout, type Box } from '../lib/graphLayout'
import { fanText, loopShort, pathSteps, stageWord } from '../lib/status'
import type { Branch, RunView, StageName, Status } from '../lib/view'

const STAGE_TITLE: Record<StageName, string> = {
  split: 'Split',
  reduce: 'Reduce',
  synthesize: 'Synthesize',
  check: 'Check',
  final: 'Final',
}

/** Below this stage width the column drawing is used, so the whole graph stays readable on a phone. */
const NARROW_BELOW = 720

const NODE_CLASS: Record<Status, string> = {
  idle: '',
  running: 'ds-g-node--active',
  ok: 'ds-g-node--done',
  failed: 'ds-g-node--failed',
  stopped: 'ds-g-node--stopped',
}
const DOT_CLASS: Record<Status, string> = {
  idle: 'ds-g-dot--idle',
  running: 'ds-g-dot--active',
  ok: 'ds-g-dot--done',
  failed: 'ds-g-dot--failed',
  stopped: 'ds-g-dot--stopped',
}

const join = (...parts: string[]): string => parts.filter((p) => p !== '').join(' ')

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

function Node({ box, title, status, word }: { box: Box; title: string; status: Status; word: string }) {
  return (
    <g>
      {status === 'running' && (
        <rect className="ds-g-halo" x={box.x - 5} y={box.y - 5} width={box.w + 10} height={box.h + 10} rx={11} />
      )}
      <rect className={join('ds-g-node', NODE_CLASS[status])} x={box.x} y={box.y} width={box.w} height={box.h} rx={8} />
      <text className="ds-g-title" x={box.x + 12} y={box.y + 24}>
        {title}
      </text>
      <circle className={join('ds-g-dot', DOT_CLASS[status])} cx={box.x + 16} cy={box.y + 41} r={4.5} />
      <text className={status === 'running' ? 'ds-g-state ds-g-state--active' : 'ds-g-state'} x={box.x + 26} y={box.y + 45}>
        {word}
      </text>
    </g>
  )
}

function Pill({ box, branch, ended }: { box: Box & { chunk: number }; branch: Branch | undefined; ended: boolean }) {
  const status: Status = branch?.status ?? 'idle'
  const retried = status === 'ok' && (branch?.attempts ?? 0) > 1
  const word = retried ? 'Retried' : stageWord(status, ended)
  return (
    <g>
      <rect className={join('ds-g-node', NODE_CLASS[status])} x={box.x} y={box.y} width={box.w} height={box.h} rx={6} />
      <text className="ds-g-sub ds-g-pill" x={box.x + 10} y={box.y + 19}>
        {`Chunk ${box.chunk}`}
      </text>
      <circle className={join('ds-g-dot', DOT_CLASS[status])} cx={box.x + 14} cy={box.y + 34} r={4} />
      <text className="ds-g-state" x={box.x + 24} y={box.y + 38}>
        {word}
      </text>
    </g>
  )
}

export function GraphView({ view }: { view: RunView }) {
  const { ref, narrow } = useNarrow()
  const count = view.branches.length
  const layout = graphLayout(count, narrow)
  const ended = view.phase === 'done' || view.phase === 'error' || view.phase === 'stopped'
  const { stages, branches } = view
  const branchFor = (chunk: number): Branch | undefined => branches.find((b) => b.chunk === chunk)
  const splitTaken = stages.split !== 'idle'
  const anyOk = branches.some((b) => b.status === 'ok')
  const taken = (key: string): boolean => {
    const chunk = /fan:(\d+)/.exec(key)?.[1]
    if (key.startsWith('split>fan')) return chunk ? (branchFor(Number(chunk))?.status ?? 'idle') !== 'idle' : splitTaken
    if (key.startsWith('fan')) return chunk ? branchFor(Number(chunk))?.status === 'ok' : anyOk
    const to = key.split('>')[1] as StageName
    return stages[to] !== 'idle'
  }
  const loopTaken = view.retryLabel !== null
  const steps = pathSteps(view)

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
          className={narrow ? 'graph-svg graph-svg--narrow' : 'graph-svg'}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="Graph: split the text, extract every chunk in parallel, reduce, synthesize, check coverage, then finish. The check can send missed chunks back once."
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
            return (
              <path
                key={edge.key}
                className={join('ds-g-edge', on ? 'ds-g-edge--taken' : '')}
                d={edge.path}
                markerEnd={on ? 'url(#arrow-taken)' : 'url(#arrow)'}
              />
            )
          })}
          <path
            className={join('ds-g-edge', 'ds-g-edge--loop', loopTaken ? 'ds-g-edge--taken' : '')}
            d={layout.loop.path}
            markerEnd={loopTaken ? 'url(#arrow-taken)' : 'url(#arrow)'}
          />
          <text
            className={loopTaken ? 'ds-g-label ds-g-label--taken' : 'ds-g-label'}
            x={layout.loop.label.x}
            y={layout.loop.label.y}
            textAnchor={layout.loop.label.anchor}
          >
            {loopShort(view)}
          </text>
          <text
            className={splitTaken ? 'ds-g-label ds-g-label--taken' : 'ds-g-label'}
            x={layout.fanLabel.x}
            y={layout.fanLabel.y}
            textAnchor={layout.fanLabel.anchor}
          >
            {fanText(view)}
          </text>
          {(Object.keys(layout.stages) as StageName[]).map((name) => (
            <Node key={name} box={layout.stages[name]} title={STAGE_TITLE[name]} status={stages[name]} word={stageWord(stages[name], ended)} />
          ))}
          {layout.pills.map((pill) => (
            <Pill key={pill.chunk} box={pill} branch={branchFor(pill.chunk)} ended={ended} />
          ))}
        </svg>
        {steps.length > 0 && (
          <ol className="ds-path" aria-label="Steps taken, in order">
            {steps.map((step, i) => (
              <li key={`${step.label}-${i}`} className={step.now ? 'ds-path__now' : undefined}>
                {step.label}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
