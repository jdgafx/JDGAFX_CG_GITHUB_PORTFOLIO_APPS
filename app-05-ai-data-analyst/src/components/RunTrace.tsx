import type { RunStep } from '../types'

const TONE: Record<RunStep['status'], string> = {
  ok: 'ds-badge--success',
  failed: 'ds-badge--danger',
  skipped: '',
}

export default function RunTrace({ steps }: { steps: RunStep[] }) {
  const slowest = Math.max(0, ...steps.map((step) => step.ms))

  return (
    <ol className="ds-trace" aria-label="Steps in this run">
      {steps.map((step, index) => {
        const share =
          slowest > 0 && step.status !== 'skipped' ? Math.max(4, Math.round((step.ms / slowest) * 100)) : 0
        return (
          <li key={`${index}-${step.name}`} className="ds-trace__step">
            <span className="ds-trace__index">{index + 1}</span>
            <div style={{ minWidth: 0 }}>
              <div className="ds-trace__name">
                {step.name} <span className={`ds-badge ${TONE[step.status]}`}>{step.status}</span>
              </div>
              <div className="ds-trace__detail">{step.detail}</div>
              {share > 0 && <div className="ds-trace__bar" style={{ width: `${share}%` }} aria-hidden="true" />}
            </div>
            <div className="ds-trace__meta">
              {step.status === 'skipped' ? 'not run' : `${step.ms.toLocaleString()} ms`}
              {step.tokens !== undefined && <div>{step.tokens.toLocaleString()} tokens</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
