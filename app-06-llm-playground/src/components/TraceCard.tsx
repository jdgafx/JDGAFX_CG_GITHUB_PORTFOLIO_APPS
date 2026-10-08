import { barPercent, formatCount, formatMs, formatUsd } from '../lib/format'
import { traceSteps, type RunView, type StepStatus } from '../lib/run'

const STEP_STATUS: Record<StepStatus, { label: string; dot: string }> = {
  ok: { label: 'Complete', dot: 'ds-dot--ok' },
  failed: { label: 'Failed', dot: 'ds-dot--failed' },
  skipped: { label: 'Skipped', dot: 'ds-dot--skipped' },
  running: { label: 'Running', dot: 'ds-dot--running' },
}

export function TraceCard({ run }: { run: RunView | null }) {
  return (
    <section className="ds-section" aria-labelledby="trace-title">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="trace-title">
          Run trace
        </h2>
        <p className="ds-section__sub">Each step in order. Times are measured on the server.</p>
      </div>
      {run ? <Trace run={run} /> : <div className="ds-empty">No run yet. Each step appears here in order.</div>}
    </section>
  )
}

function Trace({ run }: { run: RunView }) {
  const steps = traceSteps(run)
  const scale = Math.max(0, ...steps.map(step => step.ms ?? 0))
  return (
    <ol className="ds-trace">
      {steps.map((step, i) => {
        const status = STEP_STATUS[step.status]
        return (
          <li className={step.status === 'running' ? 'ds-trace__step ds-trace__step--running' : 'ds-trace__step'} key={step.name}>
            <span className="ds-trace__index">{i + 1}</span>
            <div>
              <div className="ds-row">
                <span className="ds-trace__name">{step.name}</span>
                <span className="ds-badge">
                  <span className={`ds-dot ${status.dot}`} aria-hidden="true" />
                  {status.label}
                </span>
              </div>
              <p className="ds-trace__detail">{step.detail}</p>
              {step.ms !== null && (
                <div className="ds-trace__bar" aria-hidden="true" style={{ width: `${barPercent(step.ms, scale)}%` }} />
              )}
            </div>
            <div className="ds-trace__meta arena-meta">
              <span>{formatMs(step.ms)}</span>
              {step.tokens !== null && <span>{formatCount(step.tokens)} tokens</span>}
              {step.cost && <span>{formatUsd(step.cost.usd)}</span>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
