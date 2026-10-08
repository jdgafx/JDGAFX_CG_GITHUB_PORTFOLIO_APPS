import { formatCount, formatMs, formatUsd } from '../lib/usage'
import type { StageUsage } from '../types'

export type MetricsState = 'idle' | 'running' | 'done'

interface RunMetricsProps {
  state: MetricsState
  totalMs?: number
  /** True when the run stopped before the server's total arrived, so the total is a sum of stage times. */
  totalIsStageSum: boolean
  usage: StageUsage
  model?: string
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

export function RunMetrics({ state, totalMs, totalIsStageSum, usage, model }: RunMetricsProps) {
  if (state === 'idle') return <p className="ds-hint">Metrics appear once a run starts.</p>

  const running = state === 'running'
  const pending = (text: string) => (running ? '-' : text)
  const costHint = running
    ? 'Filled in when the run ends'
    : usage.cost === undefined
      ? 'The provider sent no cost'
      : 'Reported by the provider'

  return (
    <div className="ds-metrics">
      <Metric
        label="Total latency"
        value={formatMs(totalMs)}
        hint={running ? 'Running' : totalIsStageSum ? 'Sum of stage times' : 'Measured on the server'}
      />
      <Metric label="Prompt tokens" value={pending(formatCount(usage.prompt_tokens))} />
      <Metric label="Completion tokens" value={pending(formatCount(usage.completion_tokens))} />
      <Metric label="Total tokens" value={pending(formatCount(usage.total_tokens))} />
      <Metric label="Cost (USD)" value={pending(formatUsd(usage.cost))} hint={costHint} />
      <Metric label="Served model" value={pending(model ?? 'not reported')} hint={running ? undefined : 'From the provider response'} />
    </div>
  )
}
