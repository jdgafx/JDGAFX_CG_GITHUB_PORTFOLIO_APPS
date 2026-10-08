import type { Metric } from '../lib/trace'

interface RunMetricsProps {
  metrics: Metric[]
}

export default function RunMetrics({ metrics }: RunMetricsProps) {
  return (
    <section className="ds-card" aria-labelledby="metrics-heading">
      <div className="ds-card__head">
        <h2 className="ds-card__title" id="metrics-heading">Run summary</h2>
        <span className="ds-hint">Model figures come from the planner call. The browser run calls no model.</span>
      </div>
      <div className="ds-metrics">
        {metrics.map((metric) => (
          <div className="ds-metric" key={metric.label}>
            <div className="ds-metric__label">{metric.label}</div>
            <div className="ds-metric__value">{metric.value}</div>
            <div className="ds-metric__hint">{metric.hint}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
