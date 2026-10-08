import type { RunView } from '../types'

export function formatCount(value: number | undefined): string {
  return value === undefined ? 'not reported' : value.toLocaleString()
}

/** USD, with enough digits to show a small per-call cost. */
export function formatCost(value: number): string {
  return `$${value < 0.01 ? value.toFixed(6) : value.toFixed(4)}`
}

interface ReadoutProps {
  label: string
  value: string
  hint?: string
  mono?: boolean
}

function Readout({ label, value, hint, mono = false }: ReadoutProps) {
  return (
    <div className="ds-strip__item">
      <div className="ds-strip__label">{label}</div>
      <div className={mono ? 'ds-strip__value ds-mono' : 'ds-strip__value'}>{value}</div>
      {hint && <div className="ds-strip__hint">{hint}</div>}
    </div>
  )
}

/** The run's figures as one readout strip. The first row carries the model, latency, tokens and cost. */
export default function RunMetrics({ run }: { run: RunView }) {
  const { usage } = run
  return (
    <div className="ds-strip">
      <Readout
        label="Served model"
        value={run.model ?? 'not reported'}
        mono={Boolean(run.model)}
        hint="As named in the reply"
      />
      <Readout label="Total latency" value={`${run.totalMs.toLocaleString()} ms`} hint="Measured for this run" />
      <Readout label="Total tokens" value={formatCount(usage.total_tokens)} />
      <Readout
        label="Cost (USD)"
        value={usage.cost === undefined ? 'not reported' : formatCost(usage.cost)}
        hint={usage.cost === undefined ? 'The provider did not report a cost' : 'Reported by the provider'}
      />
      <Readout label="Prompt tokens" value={formatCount(usage.prompt_tokens)} />
      <Readout label="Completion tokens" value={formatCount(usage.completion_tokens)} />
    </div>
  )
}
