import type { RunRecord } from '../hooks/useAssistant'
import type { StepStatus, TraceStep } from '../lib/api'
import { formatCount, formatMs, formatUsd } from '../lib/format'
import type { LiveStep } from '../lib/pipeline'

const STATUS: Record<StepStatus, { label: string; dot: string }> = {
  ok: { label: 'Done', dot: 'ds-dot ds-dot--ok' },
  failed: { label: 'Failed', dot: 'ds-dot ds-dot--failed' },
  skipped: { label: 'Skipped', dot: 'ds-dot ds-dot--skipped' },
}

function StatusWord({ label, dot }: { label: string; dot: string }) {
  return (
    <span className="ds-badge">
      <span className={dot} aria-hidden="true" />
      {label}
    </span>
  )
}

interface MetricProps {
  label: string
  value: string
  hint?: string
  mono?: boolean
}

function Metric({ label, value, hint, mono = false }: MetricProps) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className={mono ? 'ds-strip__value ds-mono' : 'ds-strip__value'}>
        {value}
        {hint && <span className="ds-strip__hint">{hint}</span>}
      </dd>
    </div>
  )
}

function TraceRow({ step, index, slowest }: { step: TraceStep; index: number; slowest: number }) {
  const status = STATUS[step.status]
  // The bar shows each step's share of the slowest step, so long steps stand out.
  const share = Math.max(2, Math.round((step.ms / slowest) * 100))
  return (
    <li className="ds-trace__step" data-status={step.status}>
      <span className="ds-trace__index">{index}</span>
      <div className="vox-trace-body">
        <div className="ds-row">
          <span className="ds-trace__name">{step.name}</span>
          <StatusWord label={status.label} dot={status.dot} />
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

function LiveRow({ live, index }: { live: LiveStep; index: number }) {
  return (
    <li className="ds-trace__step ds-trace__step--running" data-status="running">
      <span className="ds-trace__index">{index}</span>
      <div className="vox-trace-body">
        <div className="ds-row">
          <span className="ds-trace__name">{live.name}</span>
          <StatusWord label="Running" dot="ds-dot ds-dot--running" />
        </div>
        <p className="ds-trace__detail">{live.detail}</p>
      </div>
      <span className="ds-trace__meta" aria-hidden="true" />
    </li>
  )
}

interface RunPanelProps {
  run: RunRecord | null
  live: LiveStep | null
  pending: boolean
}

export default function RunPanel({ run, live, pending }: RunPanelProps) {
  const steps = run ? run.steps : []
  const slowest = Math.max(1, ...steps.map(step => step.ms))
  const rows = steps.length + (live ? 1 : 0)
  const empty = run === null && live === null

  return (
    <section className="ds-section" aria-labelledby="run-title">
      <div className="ds-section__head">
        <h2 id="run-title" className="ds-section__title">
          Last run
        </h2>
        <p className="ds-section__sub">
          Steps, timings and tokens for the latest question, with the cost and model the provider reports.
        </p>
      </div>
      {empty ? (
        <div className="ds-empty">Nothing has run yet. Each question lists its steps, timings and tokens here.</div>
      ) : (
        <>
          {run && (
            <dl className="ds-strip">
              <Metric
                label="Served model"
                value={pending ? 'Pending' : (run.model ?? 'not reported')}
                mono={!pending && run.model !== undefined}
              />
              <Metric label="Total latency" value={pending ? 'Pending' : formatMs(run.totalMs)} hint="Server steps" />
              <Metric
                label="Prompt tokens"
                value={pending ? 'Pending' : formatCount(run.usage?.prompt_tokens)}
              />
              <Metric
                label="Completion tokens"
                value={pending ? 'Pending' : formatCount(run.usage?.completion_tokens)}
              />
              <Metric label="Total tokens" value={pending ? 'Pending' : formatCount(run.usage?.total_tokens)} />
              <Metric
                label="Cost (USD)"
                value={pending ? 'Pending' : formatUsd(run.usage?.cost)}
                hint={run.usage?.cost === undefined || pending ? undefined : 'Reported by the provider'}
              />
            </dl>
          )}
          {rows > 0 ? (
            <ol className="ds-trace" aria-label="Steps in the last run">
              {steps.map((step, index) => (
                <TraceRow key={`${index}-${step.name}`} step={step} index={index + 1} slowest={slowest} />
              ))}
              {live && <LiveRow live={live} index={steps.length + 1} />}
            </ol>
          ) : (
            <p className="ds-help">No steps ran.</p>
          )}
        </>
      )}
    </section>
  )
}
