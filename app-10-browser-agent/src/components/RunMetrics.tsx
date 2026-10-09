import type { Metric } from '../lib/trace'

const MODEL_LABEL = 'Served model'

interface RunMetricsProps {
  metrics: Metric[]
}

/** The run's figures as one readout strip, in the order given. The served model takes a row of its own, in mono. */
export default function RunMetrics({ metrics }: RunMetricsProps) {
  return (
    <section className="ds-section" aria-labelledby="metrics-heading">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="metrics-heading">Run figures</h2>
        <p className="ds-section__sub">Model figures come from the planner call. The browser run calls no model.</p>
      </div>
      <dl className="ds-strip bb-readout">
        {metrics.map((metric) => {
          const isModel = metric.label === MODEL_LABEL
          return (
            <div className={isModel ? 'ds-strip__item bb-readout__model' : 'ds-strip__item'} key={metric.label}>
              <dt className="ds-strip__label">{metric.label}</dt>
              <dd className={isModel ? 'ds-strip__value ds-mono' : 'ds-strip__value'}>{metric.value}</dd>
              <dd className="ds-strip__hint">{metric.hint}</dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}
