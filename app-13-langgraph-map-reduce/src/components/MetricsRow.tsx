import type { RunMetrics } from '../types/frames'
import { formatCost, formatMs, formatTokens } from '../lib/format'

interface MetricProps {
  label: string
  value: string
  hint: string
}

function Metric({ label, value, hint }: MetricProps) {
  return (
    <div className="ds-metric" role="listitem">
      <div className="ds-metric__label">{label}</div>
      <div className="ds-metric__value">{value}</div>
      <div className="ds-metric__hint">{hint}</div>
    </div>
  )
}

function costHint(metrics: RunMetrics | null): string {
  if (!metrics || metrics.totalCost === null) return 'no cost reported yet'
  return metrics.costSource === 'estimated' ? 'estimated from list prices' : 'as reported by OpenRouter'
}

export function MetricsRow({ metrics, complete }: { metrics: RunMetrics | null; complete: boolean }) {
  return (
    <div className="ds-metrics" role="list" aria-label="Run totals">
      <Metric
        label="Total time"
        value={metrics && complete ? formatMs(metrics.totalMs) : 'n/a'}
        hint={complete ? 'wall clock, whole run' : 'shown when the run finishes'}
      />
      <Metric
        label="Total tokens"
        value={metrics ? formatTokens(metrics.totalTokens) : 'n/a'}
        hint="prompt plus completion, all calls"
      />
      <Metric
        label="Total cost"
        value={metrics ? formatCost(metrics.totalCost) : 'n/a'}
        hint={costHint(metrics)}
      />
      <Metric
        label="Cheap calls"
        value={metrics ? formatCost(metrics.cheapCost) : 'n/a'}
        hint={metrics ? `${metrics.cheapCalls} calls: extract and check` : 'extract and check'}
      />
      <Metric
        label="Synthesis call"
        value={metrics ? formatCost(metrics.synthesisCost) : 'n/a'}
        hint="one stronger call per pass"
      />
    </div>
  )
}
