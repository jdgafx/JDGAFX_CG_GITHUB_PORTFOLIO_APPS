import { ExternalLink, Wrench } from 'lucide-react'
import type { StepStatus, TraceStep } from '../lib/api'
import { formatCount, formatMs } from '../lib/format'
import type { LiveStep } from '../lib/pipeline'
import type { RunState } from '../lib/run'
import { lanes, readingNote } from '../lib/view'

const STATE: Record<StepStatus, { label: string; dot: string; row: string }> = {
  ok: { label: 'Done', dot: 'ds-dot ds-dot--ok', row: '' },
  failed: { label: 'Failed', dot: 'ds-dot ds-dot--failed', row: ' ds-trace__step--failed' },
  skipped: { label: 'Skipped', dot: 'ds-dot ds-dot--skipped', row: '' },
}

// The address without its scheme and query, which is what a reader can take in.
function sourceLabel(source: string): string {
  const { host, pathname } = new URL(source)
  return `${host}${pathname === '/' ? '' : pathname}`
}

function Row({ step, index, lane, stopped }: { step: TraceStep; index: number; lane: { left: number; width: number }; stopped: boolean }) {
  const state = STATE[step.status]
  const note = readingNote(step)
  const row = step.status === 'skipped' && stopped && step.detail === 'Stopped by you' ? ' ds-trace__step--stopped' : state.row
  return (
    <li className={`ds-trace__step${row}`}>
      <span className="ds-trace__index">{index}</span>
      <div>
        <div className="ds-trace__head">
          <span className="ds-trace__name">
            {step.call && <Wrench className="vox-tool-icon" size={14} aria-hidden="true" />}
            {step.name}
          </span>
          <span className={`ds-trace__state ds-trace__state--${step.status === 'ok' ? 'ok' : step.status === 'failed' ? 'failed' : row.includes('stopped') ? 'stopped' : ''}`}>
            <span className={state.dot} aria-hidden="true" />
            {state.label}
          </span>
        </div>
        {step.call && <code className="vox-call">{step.call}</code>}
        <p className="ds-trace__detail">{step.detail}</p>
        {note && <p className="ds-trace__detail">{note}</p>}
        {step.source && (
          <a className="vox-source" href={step.source} target="_blank" rel="noreferrer noopener" title={step.source}>
            <span className="vox-source__label">Source</span>
            <span className="vox-source__url">{sourceLabel(step.source)}</span>
            <ExternalLink size={12} aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
      <span className="ds-trace__meta">
        <span>{formatMs(step.ms)}</span>
        {step.tokens !== undefined && <span>{formatCount(step.tokens)} tokens</span>}
      </span>
      <div className="ds-trace__lane" aria-hidden="true">
        <div className="ds-trace__bar" style={{ left: `${lane.left}%`, width: `${lane.width}%` }} />
      </div>
    </li>
  )
}

function LiveRow({ live, index }: { live: LiveStep; index: number }) {
  return (
    <li className="ds-trace__step ds-trace__step--running">
      <span className="ds-trace__index">{index}</span>
      <div>
        <div className="ds-trace__head">
          <span className="ds-trace__name">{live.name}</span>
          <span className="ds-trace__state ds-trace__state--running">
            <span className="ds-dot ds-dot--running" aria-hidden="true" />
            Running
          </span>
        </div>
        <p className="ds-trace__detail">{live.detail}</p>
      </div>
      <span className="ds-trace__meta" aria-hidden="true" />
      <div className="ds-trace__lane" aria-hidden="true">
        <div className="ds-trace__bar ds-trace__bar--live" style={{ left: '0%', width: '100%' }} />
      </div>
    </li>
  )
}

export default function Trace({ run, live }: { run: RunState; live: LiveStep | null }) {
  const steps = run.steps
  const laneList = lanes(steps)
  const empty = steps.length === 0 && live === null
  return (
    <section className="ds-section ds-run__trace" aria-labelledby="trace-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="trace-title" className="ds-section__title">
          Run trace
        </h2>
        <p className="ds-section__sub">Bars show each step&rsquo;s share of the run. Tool calls appear before the answer they feed.</p>
      </div>
      {empty ? (
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">No steps yet</p>
          <p className="ds-state__body">Ask a question to see each step, its time, and the weather or Wikipedia calls the model made.</p>
        </div>
      ) : (
        <ol className="ds-trace" aria-label="Steps in the run">
          {steps.map((step, i) => (
            <Row key={`${i}-${step.name}`} step={step} index={i + 1} lane={laneList[i]} stopped={run.outcome === 'stopped'} />
          ))}
          {live && <LiveRow live={live} index={steps.length + 1} />}
        </ol>
      )}
    </section>
  )
}
