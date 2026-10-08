import type { RunUsage } from '../lib/api'

interface RunMetricsProps {
  totalMs: number | null
  usage: RunUsage | null
  model: string | null
}

// Every value is either measured or reported by the provider. A missing one reads "not reported", never a guess.
const count = (n: number | undefined) => (n === undefined ? 'not reported' : n.toLocaleString())
const cost = (usd: number | undefined) =>
  usd === undefined ? 'not reported' : `$${usd.toFixed(usd < 0.01 ? 6 : 4)}`

export default function RunMetrics({ totalMs, usage, model }: RunMetricsProps) {
  const items = [
    { label: 'Total latency', value: totalMs === null ? 'not reported' : `${totalMs.toLocaleString()} ms`, hint: 'Measured on the server' },
    { label: 'Prompt tokens', value: count(usage?.prompt_tokens), hint: 'Reported by the provider' },
    { label: 'Completion tokens', value: count(usage?.completion_tokens), hint: 'Reported by the provider' },
    { label: 'Total tokens', value: count(usage?.total_tokens), hint: 'Reported by the provider' },
    { label: 'Cost (USD)', value: cost(usage?.cost), hint: 'Reported by the provider' },
    { label: 'Served model', value: model ?? 'not reported', hint: 'As named in the response' },
  ]

  return (
    <section className="ds-card" aria-labelledby="run-metrics-title">
      <div className="ds-card__head">
        <h2 id="run-metrics-title" className="ds-card__title">Run metrics</h2>
        <span className="ds-hint">Figures for this run only</span>
      </div>
      <div className="ds-metrics">
        {items.map((item) => (
          <div key={item.label} className="ds-metric">
            <p className="ds-metric__label">{item.label}</p>
            <p className="ds-metric__value">{item.value}</p>
            <p className="ds-metric__hint">{item.hint}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
