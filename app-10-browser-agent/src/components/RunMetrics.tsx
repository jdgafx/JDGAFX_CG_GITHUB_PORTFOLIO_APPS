import type { Metric } from '../lib/trace'

/** The order the readout reads in: the served model, the tokens, the cost, then the run time. */
const ORDER = ['Served model', 'Prompt tokens', 'Completion tokens', 'Total tokens', 'Cost (USD)', 'Total latency']
const MODEL_LABEL = 'Served model'

interface RunMetricsProps {
  metrics: Metric[]
}

/** The run's figures as one readout strip. The served model takes a row of its own, in mono. */
export default function RunMetrics({ metrics }: RunMetricsProps) {
  const ordered = ORDER.flatMap((label) => metrics.filter((metric) => metric.label === label))

  return (
    <section className="ds-section" aria-labelledby="metrics-heading">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="metrics-heading">Run figures</h2>
        <p className="ds-section__sub">Model figures come from the planner call. The browser run calls no model.</p>
      </div>
      <dl className="ds-strip bb-readout">
        {ordered.map((metric) => {
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
