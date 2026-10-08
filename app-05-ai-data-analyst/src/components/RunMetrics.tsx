import type { RunView } from '../types'

function count(value: number | undefined): string {
  return value === undefined ? 'not reported' : value.toLocaleString()
}

function cost(value: number | undefined): string {
  if (value === undefined) return 'not reported'
  return `$${value < 0.01 ? value.toFixed(6) : value.toFixed(4)}`
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

export default function RunMetrics({ run }: { run: RunView }) {
  const { usage } = run
  return (
    <div className="ds-metrics app-metrics">
      <Metric label="Total latency" value={`${run.totalMs.toLocaleString()} ms`} hint="Measured for this run" />
      <Metric label="Prompt tokens" value={count(usage.prompt_tokens)} />
      <Metric label="Completion tokens" value={count(usage.completion_tokens)} />
      <Metric label="Total tokens" value={count(usage.total_tokens)} />
      <Metric
        label="Cost (USD)"
        value={cost(usage.cost)}
        hint={usage.cost === undefined ? 'The provider did not report a cost' : 'Reported by the provider'}
      />
      <Metric label="Served model" value={run.model ?? 'not reported'} hint="As named in the reply" />
    </div>
  )
}
