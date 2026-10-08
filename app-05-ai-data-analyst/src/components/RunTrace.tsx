import type { RunStep, StepStatus } from '../types'
import { formatCost } from './RunMetrics'

const WORD: Record<StepStatus, string> = {
  ok: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
}

interface RunTraceProps {
  steps?: RunStep[]
  /** True while the reply is in flight. The server sends the steps only when the run ends. */
  pending?: boolean
}

export default function RunTrace({ steps = [], pending = false }: RunTraceProps) {
  if (pending) {
    return (
      <ol className="ds-trace" aria-label="Steps in this run">
        <li className="ds-trace__step ds-trace__step--running">
          <span className="ds-trace__index" aria-hidden="true" />
          <div style={{ minWidth: 0 }}>
            <div className="app-step-head">
              <span className="ds-trace__name">Waiting for the reply</span>
              <span className="app-step-status">
                <span className="ds-dot ds-dot--running" aria-hidden="true" />
                Running
              </span>
            </div>
            <div className="ds-trace__detail">Each step appears here when the reply arrives.</div>
          </div>
          <div className="ds-trace__meta" />
        </li>
      </ol>
    )
  }

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
              <div className="app-step-head">
                <span className="ds-trace__name">{step.name}</span>
                <span className={`app-step-status app-step-status--${step.status}`}>
                  <span className={`ds-dot ds-dot--${step.status}`} aria-hidden="true" />
                  {WORD[step.status]}
                </span>
              </div>
              <div className="ds-trace__detail">{step.detail}</div>
              {share > 0 && <div className="ds-trace__bar" style={{ width: `${share}%` }} aria-hidden="true" />}
            </div>
            <div className="ds-trace__meta">
              {step.status === 'skipped' ? 'not run' : `${step.ms.toLocaleString()} ms`}
              {step.tokens !== undefined && <div>{step.tokens.toLocaleString()} tokens</div>}
              {step.cost !== undefined && <div>{formatCost(step.cost)}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
