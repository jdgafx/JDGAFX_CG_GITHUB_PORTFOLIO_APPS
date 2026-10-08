import type { TraceStep } from '../lib/api'

const BADGE: Record<TraceStep['status'], string> = {
  ok: 'ds-badge ds-badge--success',
  failed: 'ds-badge ds-badge--danger',
  skipped: 'ds-badge',
}

interface RunTraceProps {
  steps: TraceStep[]
}

/** The stages of one run, in order, with the server's own timings. */
export default function RunTrace({ steps }: RunTraceProps) {
  const totalMs = steps.reduce((sum, step) => sum + step.ms, 0)

  return (
    <section className="ds-card" aria-labelledby="trace-title">
      <div className="ds-card__head">
        <h2 id="trace-title" className="ds-card__title">Run trace</h2>
        <span className="ds-hint">Each stage timed on the server</span>
      </div>
      <ol className="ds-trace">
        {steps.map((step, i) => (
          <li key={step.name} className="ds-trace__step">
            <span className="ds-trace__index">{i + 1}</span>
            <div className="hub-trace__body">
              <div className="ds-row">
                <span className="ds-trace__name">{step.name}</span>
                <span className={BADGE[step.status]}>{step.status}</span>
              </div>
              <p className="ds-trace__detail">{step.detail}</p>
              <div
                className="ds-trace__bar"
                style={{ width: totalMs > 0 ? `${(step.ms / totalMs) * 100}%` : '0%' }}
                aria-hidden="true"
              />
            </div>
            <span className="ds-trace__meta">
              {step.ms} ms
              {step.tokens !== undefined && <span className="hub-trace__extra">{step.tokens.toLocaleString()} tokens</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
