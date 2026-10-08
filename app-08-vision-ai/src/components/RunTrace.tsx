import type { StepStatus, TraceStep, RunSummary } from '../lib/api'
import { formatCount, formatMs, formatUsd } from '../lib/format'

const STEP_BADGE: Record<StepStatus, { label: string; className: string }> = {
  running: { label: 'Running', className: 'ds-badge--accent' },
  ok: { label: 'OK', className: 'ds-badge--success' },
  failed: { label: 'Failed', className: 'ds-badge--danger' },
  skipped: { label: 'Skipped', className: '' },
}

interface RunTraceProps {
  steps: TraceStep[]
  summary: RunSummary | null
}

// Each bar is the step's share of the total time, so the slow stage is visible at a glance.
function sharePercent(ms: number | undefined, total: number): string {
  if (ms === undefined || total <= 0) return '0%'
  return `${Math.min(100, (ms / total) * 100).toFixed(1)}%`
}

export default function RunTrace({ steps, summary }: RunTraceProps) {
  const total = summary?.totalMs ?? 0

  return (
    <section className="ds-card" aria-labelledby="trace-title">
      <div className="ds-card__head">
        <h2 id="trace-title" className="ds-card__title">
          Run trace
        </h2>
        <span className="ds-hint">Each bar is that step&apos;s share of total time.</span>
      </div>

      {steps.length === 0 ? (
        <div className="ds-empty">Each step of a run appears here, with its time and outcome.</div>
      ) : (
        <ol className="ds-trace">
          {steps.map((step, index) => {
            const badge = STEP_BADGE[step.status]
            return (
              <li key={`${step.name}-${index}`} className="ds-trace__step">
                <span className="ds-trace__index">{index + 1}</span>
                <div>
                  <p className="ds-trace__name">{step.name}</p>
                  <p className="ds-trace__detail">{step.detail}</p>
                  <div className="ds-trace__bar" aria-hidden="true" style={{ width: sharePercent(step.ms, total) }} />
                </div>
                <div className="ds-trace__meta">
                  <span className={`ds-badge ${badge.className}`}>{badge.label}</span>
                  <div>{step.ms === undefined ? 'not measured' : formatMs(step.ms)}</div>
                  {step.tokens !== undefined && <div>{formatCount(step.tokens)} tokens</div>}
                  {step.cost !== undefined && <div>{formatUsd(step.cost)}</div>}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {summary && (
        <div className="ds-metrics run-metrics">
          <Metric label="Total latency" value={formatMs(summary.totalMs)} />
          <Metric label="Prompt tokens" value={formatCount(summary.usage?.prompt_tokens)} />
          <Metric label="Completion tokens" value={formatCount(summary.usage?.completion_tokens)} />
          <Metric label="Total tokens" value={formatCount(summary.usage?.total_tokens)} />
          <Metric label="Cost (USD)" value={formatUsd(summary.usage?.cost)} hint="As reported by the provider" />
          <Metric label="Served model" value={summary.model ?? 'not reported'} />
        </div>
      )}
    </section>
  )
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="ds-metric">
      <p className="ds-metric__label">{label}</p>
      <p className="ds-metric__value">{value}</p>
      {hint && <p className="ds-metric__hint">{hint}</p>}
    </div>
  )
}
