import type { ReactNode } from 'react'
import { PIPELINE_STAGES } from '../constants'
import type { RunPhase, RunSummary, StepStatus, TraceStep } from '../types'

const STEP_STATUS: Record<StepStatus, { label: string; dot: string }> = {
  ok: { label: 'Done', dot: 'ds-dot--ok' },
  failed: { label: 'Failed', dot: 'ds-dot--failed' },
  skipped: { label: 'Skipped', dot: 'ds-dot--skipped' },
}

const count = (value: number) => value.toLocaleString('en-US')

interface TraceRowProps {
  index: number
  step: TraceStep
  totalMs: number
}

function TraceRow({ index, step, totalMs }: TraceRowProps) {
  const status = STEP_STATUS[step.status]
  const share = totalMs > 0 ? Math.max(2, Math.round((step.ms / totalMs) * 100)) : 0

  return (
    <li className="ds-trace__step">
      <span className="ds-trace__index">{index}</span>
      <div>
        <div className="trace-name">
          <span className="ds-trace__name">{step.name}</span>
          <span className="trace-state">
            <span className={`ds-dot ${status.dot}`} aria-hidden="true" />
            {status.label}
          </span>
        </div>
        <div className="ds-trace__detail">{step.detail}</div>
        {step.status !== 'skipped' && <div className="ds-trace__bar" style={{ width: `${share}%` }} />}
      </div>
      <div className="ds-trace__meta">
        {step.status === 'skipped' ? 'Not timed' : `${count(step.ms)} ms`}
        {step.tokens !== undefined && <div>{count(step.tokens)} tokens</div>}
      </div>
    </li>
  )
}

/** A stage before any run: its name and what it does, with no status, because nothing has run yet. */
function StageRow({ index, name, detail }: { index: number; name: string; detail: string }) {
  return (
    <li className="ds-trace__step">
      <span className="ds-trace__index">{index}</span>
      <div>
        <div className="ds-trace__name">{name}</div>
        <div className="ds-trace__detail">{detail}</div>
      </div>
    </li>
  )
}

interface RunTraceProps {
  phase: RunPhase
  summary: RunSummary | null
}

export function RunTrace({ phase, summary }: RunTraceProps) {
  let content: ReactNode
  if (summary && summary.trace.length > 0) {
    content = (
      <ol className="ds-trace">
        {summary.trace.map((step, i) => (
          <TraceRow key={`${step.name}-${i}`} index={i + 1} step={step} totalMs={summary.totalMs} />
        ))}
      </ol>
    )
  } else if (summary) {
    content = <div className="ds-empty">No stage reported for this run.</div>
  } else if (phase === 'failed') {
    content = <div className="ds-empty">The run failed before any stage reported.</div>
  } else {
    content = (
      <>
        <ol className="ds-trace">
          {PIPELINE_STAGES.map((stage, i) => (
            <StageRow key={stage.name} index={i + 1} name={stage.name} detail={stage.detail} />
          ))}
        </ol>
        <p className="ds-help">
          {phase === 'running'
            ? 'Waiting for the server to report each stage.'
            : 'Run a review to see each stage, how long it took and what it produced.'}
        </p>
      </>
    )
  }

  return (
    <section className="ds-section" aria-labelledby="trace-title">
      <div className="ds-section__head">
        <h2 id="trace-title" className="ds-section__title">
          Run trace
        </h2>
        <p className="ds-section__sub">Each stage in order, with its status and time. Times are in milliseconds.</p>
      </div>
      {content}
    </section>
  )
}
