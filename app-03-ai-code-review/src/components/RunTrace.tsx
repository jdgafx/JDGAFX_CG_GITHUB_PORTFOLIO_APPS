import type { ReactNode } from 'react'
import type { RunPhase, RunSummary, StepStatus, TraceStep } from '../types'

const STEP_BADGE: Record<StepStatus, { label: string; tone: string }> = {
  ok: { label: 'OK', tone: 'ds-badge--success' },
  failed: { label: 'Failed', tone: 'ds-badge--danger' },
  skipped: { label: 'Skipped', tone: '' },
}

const count = (value: number) => value.toLocaleString('en-US')

const tokenText = (value: number | undefined) => (value === undefined ? 'not reported' : count(value))

const costText = (cost: number | undefined) => (cost === undefined ? 'not reported' : `$${cost.toFixed(6)}`)

interface TraceRowProps {
  index: number
  step: TraceStep
  totalMs: number
}

function TraceRow({ index, step, totalMs }: TraceRowProps) {
  const badge = STEP_BADGE[step.status]
  const share = totalMs > 0 ? Math.max(2, Math.round((step.ms / totalMs) * 100)) : 0

  return (
    <li className="ds-trace__step">
      <span className="ds-trace__index">{index}</span>
      <div>
        <div className="ds-trace__name">
          {step.name} <span className={`ds-badge ${badge.tone}`}>{badge.label}</span>
        </div>
        <div className="ds-trace__detail">{step.detail}</div>
        {step.status !== 'skipped' && <div className="ds-trace__bar" style={{ width: `${share}%` }} />}
      </div>
      <div className="ds-trace__meta">
        {step.status === 'skipped' ? '—' : `${count(step.ms)} ms`}
        {step.tokens !== undefined && <div>{count(step.tokens)} tokens</div>}
      </div>
    </li>
  )
}

interface MetricProps {
  label: string
  value: string
  hint?: string
  small?: boolean
}

function Metric({ label, value, hint, small = false }: MetricProps) {
  return (
    <div className="ds-metric">
      <div className="ds-metric__label">{label}</div>
      <div className={small ? 'ds-metric__value metric-value--small' : 'ds-metric__value'}>{value}</div>
      {hint && <div className="ds-metric__hint">{hint}</div>}
    </div>
  )
}

function Metrics({ summary }: { summary: RunSummary }) {
  const { usage } = summary
  return (
    <div className="ds-metrics">
      <Metric label="Total latency" value={`${count(summary.totalMs)} ms`} />
      <Metric label="Prompt tokens" value={tokenText(usage?.prompt_tokens)} />
      <Metric label="Completion tokens" value={tokenText(usage?.completion_tokens)} />
      <Metric label="Total tokens" value={tokenText(usage?.total_tokens)} />
      <Metric
        label="Cost (USD)"
        value={costText(usage?.cost)}
        hint={usage?.cost === undefined ? 'The provider did not report a cost' : 'Reported by the provider'}
      />
      <Metric
        label="Served model"
        value={summary.model ?? 'not reported'}
        hint={summary.model ? "Named in the provider's reply" : 'The reply named no model'}
        small
      />
    </div>
  )
}

interface RunTraceProps {
  phase: RunPhase
  summary: RunSummary | null
}

export function RunTrace({ phase, summary }: RunTraceProps) {
  let content: ReactNode
  if (phase === 'running') {
    content = <div className="ds-empty">Waiting for the server to report each stage.</div>
  } else if (!summary) {
    content = (
      <div className="ds-empty">Run a review to see each stage, how long it took and what it produced.</div>
    )
  } else {
    content = (
      <>
        {summary.trace.length > 0 && (
          <ol className="ds-trace">
            {summary.trace.map((step, i) => (
              <TraceRow key={`${step.name}-${i}`} index={i + 1} step={step} totalMs={summary.totalMs} />
            ))}
          </ol>
        )}
        <Metrics summary={summary} />
      </>
    )
  }

  return (
    <section className="ds-card" aria-labelledby="trace-title">
      <div className="ds-card__head">
        <h2 id="trace-title" className="ds-card__title">
          Run trace
        </h2>
        <span className="ds-hint">Times in milliseconds</span>
      </div>
      <div className="ds-stack">{content}</div>
    </section>
  )
}
