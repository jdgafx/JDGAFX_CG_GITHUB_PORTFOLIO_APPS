import type { RunRecord } from '../hooks/useAssistant'
import type { StepStatus, TraceStep } from '../lib/api'
import { formatCount, formatMs, formatUsd } from '../lib/format'

const STATUS_BADGES: Record<StepStatus, { label: string; className: string }> = {
  ok: { label: 'Done', className: 'ds-badge ds-badge--success' },
  failed: { label: 'Failed', className: 'ds-badge ds-badge--danger' },
  skipped: { label: 'Skipped', className: 'ds-badge' },
}

interface RunPanelProps {
  run: RunRecord | null
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="ds-metric">
      <div className="ds-metric__label">{label}</div>
      <div className="ds-metric__value">{value}</div>
      {hint && <div className="ds-metric__hint">{hint}</div>}
    </div>
  )
}

function TraceRow({ step, index, slowest }: { step: TraceStep; index: number; slowest: number }) {
  const badge = STATUS_BADGES[step.status]
  // The bar shows each step's share of the slowest step, so long steps stand out.
  const share = Math.max(2, Math.round((step.ms / slowest) * 100))
  return (
    <li className="ds-trace__step" data-status={step.status}>
      <span className="ds-trace__index">{index}</span>
      <div className="vox-trace-body">
        <div className="ds-row">
          <span className="ds-trace__name">{step.name}</span>
          <span className={badge.className}>{badge.label}</span>
        </div>
        <p className="ds-trace__detail">{step.detail}</p>
        <div className="ds-trace__bar" style={{ width: `${share}%` }} aria-hidden="true" />
      </div>
      <span className="ds-trace__meta">
        {formatMs(step.ms)}
        {step.tokens !== undefined && (
          <>
            <br />
            {formatCount(step.tokens)} tokens
          </>
        )}
      </span>
    </li>
  )
}

export default function RunPanel({ run }: RunPanelProps) {
  const slowest = run ? Math.max(1, ...run.steps.map(step => step.ms)) : 1
  return (
    <section className="ds-card" aria-labelledby="run-title">
      <div className="ds-card__head">
        <h2 id="run-title" className="ds-card__title">
          Last run
        </h2>
        <span className="ds-hint">Steps, timings and tokens</span>
      </div>
      {run === null ? (
        <div className="ds-empty">Each question shows its steps here, with timings and token use.</div>
      ) : (
        <div className="ds-stack">
          {run.steps.length > 0 ? (
            <ol className="ds-trace" aria-label="Steps in the last run">
              {run.steps.map((step, index) => (
                <TraceRow key={`${index}-${step.name}`} step={step} index={index + 1} slowest={slowest} />
              ))}
            </ol>
          ) : (
            <p className="ds-hint">No steps ran.</p>
          )}
          <div className="ds-metrics">
            <Metric label="Total latency" value={formatMs(run.totalMs)} hint="Server steps" />
            <Metric label="Prompt tokens" value={formatCount(run.usage?.prompt_tokens)} />
            <Metric label="Completion tokens" value={formatCount(run.usage?.completion_tokens)} />
            <Metric label="Total tokens" value={formatCount(run.usage?.total_tokens)} />
            <Metric
              label="Cost (USD)"
              value={formatUsd(run.usage?.cost)}
              hint={run.usage?.cost === undefined ? undefined : 'Reported by the provider'}
            />
            <Metric label="Served model" value={run.model ?? 'not reported'} />
          </div>
        </div>
      )}
    </section>
  )
}
