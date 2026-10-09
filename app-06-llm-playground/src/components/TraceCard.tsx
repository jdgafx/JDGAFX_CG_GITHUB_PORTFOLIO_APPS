import { barPercent, formatCount, formatMs, formatUsd } from '../lib/format'
import { traceSteps, type RunView, type StepStatus } from '../lib/run'

const STEP_STATUS: Record<StepStatus, { label: string; state: string; step: string }> = {
  ok: { label: 'Complete', state: 'ds-trace__state--ok', step: '' },
  failed: { label: 'Failed', state: 'ds-trace__state--failed', step: ' ds-trace__step--failed' },
  skipped: { label: 'Skipped', state: '', step: '' },
  running: { label: 'Running', state: 'ds-trace__state--running', step: ' ds-trace__step--running' },
}

export function TraceCard({ run }: { run: RunView | null }) {
  return (
    <section className="ds-section" aria-labelledby="trace-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 className="ds-section__title" id="trace-title">Run trace</h2>
        <p className="ds-section__sub">
          Bars show how long each step took, against the slowest step. Times are measured on the server.
        </p>
      </div>
      {run ? <Trace run={run} /> : <div className="ds-empty">No run yet. Each step appears here in order.</div>}
    </section>
  )
}

function Trace({ run }: { run: RunView }) {
  const steps = traceSteps(run)
  // The panels run together from the start; the judge starts when the panels are done.
  const startOf = (name: string) => (name === 'Judge' ? (run.compare?.totalMs ?? run.blind?.totalMs ?? 0) : 0)
  const scale = Math.max(0, ...steps.map(step => startOf(step.name) + (step.ms ?? 0)))
  return (
    <ol className="ds-trace">
      {steps.map((step, i) => {
        const status = STEP_STATUS[step.status]
        const stopped = step.status === 'failed' && run.status === 'stopped'
        return (
          <li className={`ds-trace__step${status.step}${stopped ? ' ds-trace__step--stopped' : ''}`} key={step.name}>
            <span className="ds-trace__index">{i + 1}</span>
            <div>
              <div className="ds-trace__head">
                <span className="ds-trace__name">{step.name}</span>
                <span className={`ds-trace__state ${status.state}`}>
                  {step.status === 'failed' && <span aria-hidden="true">! </span>}
                  {stopped ? 'Stopped' : status.label}
                </span>
              </div>
              <p className="ds-trace__detail">{step.detail}</p>
            </div>
            <div className="ds-trace__meta arena-meta">
              <span>{step.status === 'running' ? 'running' : formatMs(step.ms)}</span>
              {step.tokens !== null && <span>{formatCount(step.tokens)} tokens</span>}
              {step.cost && <span>{formatUsd(step.cost.usd)}</span>}
            </div>
            {step.ms !== null && (
              <div className="ds-trace__lane" aria-hidden="true">
                <div
                  className={step.status === 'running' ? 'ds-trace__bar ds-trace__bar--live' : 'ds-trace__bar'}
                  style={{ left: `${barPercent(startOf(step.name), scale)}%`, width: `${barPercent(step.ms, scale)}%` }}
                />
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
