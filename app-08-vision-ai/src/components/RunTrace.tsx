import type { StepStatus, TraceStep, RunSummary } from '../lib/api'
import { formatCount, formatMs, formatUsd } from '../lib/format'

// Each state is a dot plus its word, so no state relies on colour alone.
const STEP_STATE: Record<StepStatus, { label: string; badge: string; dot: string }> = {
  running: { label: 'Running', badge: 'ds-badge--accent', dot: 'ds-dot--running' },
  ok: { label: 'Done', badge: 'ds-badge--success', dot: 'ds-dot--ok' },
  failed: { label: 'Failed', badge: 'ds-badge--danger', dot: 'ds-dot--failed' },
  skipped: { label: 'Skipped', badge: '', dot: 'ds-dot--skipped' },
}

// Each bar is the step's share of the total time, so the slow stage is visible at a glance.
function sharePercent(ms: number | undefined, total: number): string {
  if (ms === undefined || total <= 0) return '0%'
  return `${Math.min(100, (ms / total) * 100).toFixed(1)}%`
}

interface RunTraceProps {
  steps: TraceStep[]
  summary: RunSummary | null
}

export default function RunTrace({ steps, summary }: RunTraceProps) {
  const total = summary?.totalMs ?? 0

  return (
    <section className="ds-section" aria-labelledby="trace-title">
      <div className="ds-section__head">
        <h2 id="trace-title" className="ds-section__title">
          Run trace
        </h2>
        <p className="ds-section__sub">Each bar is that step&apos;s share of total time.</p>
      </div>

      {steps.length === 0 ? (
        <div className="ds-empty">Analyze an image to see its three steps here, each with its time and outcome.</div>
      ) : (
        <ol className="ds-trace">
          {steps.map((step, index) => {
            const state = STEP_STATE[step.status]
            return (
              <li
                key={`${step.name}-${index}`}
                className={step.status === 'running' ? 'ds-trace__step ds-trace__step--running' : 'ds-trace__step'}
              >
                <span className="ds-trace__index">{index + 1}</span>
                <div>
                  <p className="ds-trace__name">{step.name}</p>
                  <p className="ds-trace__detail">{step.detail}</p>
                  <div className="ds-trace__bar" aria-hidden="true" style={{ width: sharePercent(step.ms, total) }} />
                </div>
                <div className="ds-trace__meta">
                  <span className={`ds-badge ${state.badge}`}>
                    <span className={`ds-dot ${state.dot}`} aria-hidden="true" />
                    {state.label}
                  </span>
                  <div>{step.ms === undefined ? 'not measured' : formatMs(step.ms)}</div>
                  {step.tokens !== undefined && <div>{formatCount(step.tokens)} tokens</div>}
                  {step.cost !== undefined && <div>{formatUsd(step.cost)}</div>}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
