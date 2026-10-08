import { formatCount, formatMs, formatUsd, type RunTotals } from '../lib/run'

interface MetricProps {
  label: string
  value: string
  hint: string
}

function Metric({ label, value, hint }: MetricProps) {
  return (
    <div className="ds-metric">
      <div className="ds-metric__label">{label}</div>
      <div className="ds-metric__value">{value}</div>
      <div className="ds-metric__hint">{hint}</div>
    </div>
  )
}

function callsWord(count: number): string {
  return count === 1 ? 'call' : 'calls'
}

function usageHint(reported: number, calls: number): string {
  if (reported === calls) return `All ${calls} ${callsWord(calls)} reported usage`
  if (reported === 0) return 'No call reported usage'
  return `${reported} of ${calls} calls reported usage`
}

interface RunSummaryProps {
  totals: RunTotals | null
}

export default function RunSummary({ totals }: RunSummaryProps) {
  if (!totals) {
    return <div className="ds-empty">Totals appear after the first stage call.</div>
  }

  const { calls } = totals
  const costHint = totals.costCalls === calls
    ? 'Reported by the provider'
    : totals.costCalls === 0
      ? 'No call reported a cost'
      : `${totals.costCalls} of ${calls} calls reported a cost`

  return (
    <div className="ds-metrics">
      <Metric label="Total latency" value={formatMs(totals.ms)} hint={`Sum of ${calls} ${callsWord(calls)}`} />
      <Metric
        label="Prompt tokens"
        value={totals.promptTokens === null ? 'not reported' : formatCount(totals.promptTokens)}
        hint={usageHint(totals.usageCalls, calls)}
      />
      <Metric
        label="Completion tokens"
        value={totals.completionTokens === null ? 'not reported' : formatCount(totals.completionTokens)}
        hint={usageHint(totals.usageCalls, calls)}
      />
      <Metric
        label="Total tokens"
        value={totals.totalTokens === null ? 'not reported' : formatCount(totals.totalTokens)}
        hint={usageHint(totals.usageCalls, calls)}
      />
      <Metric
        label="Cost (USD)"
        value={totals.cost === null ? 'not reported' : formatUsd(totals.cost)}
        hint={costHint}
      />
      <Metric
        label="Served model"
        value={totals.models.length > 0 ? totals.models.join(', ') : 'not reported'}
        hint="As reported by the provider"
      />
    </div>
  )
}
