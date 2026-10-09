import type { Phase } from '../lib/runState'
import type { Metric } from '../lib/trace'

const MODEL_LABEL = 'Served model'

interface RunMetricsProps {
  metrics: Metric[]
  phase: Phase
}

/** The run's figures as one readout strip. The served model is a chip with the full id in its title. */
export default function RunMetrics({ metrics, phase }: RunMetricsProps) {
  const tone = phase === 'idle' ? ' ds-strip--pending' : phase === 'planning' || phase === 'running' ? ' ds-strip--live' : ''
  return (
    <section className="ds-section ds-run__readout" aria-label="Run figures">
      <dl className={`ds-strip bb-readout${tone}`}>
        {metrics.map((metric) => {
          const isModel = metric.label === MODEL_LABEL
          const chip = isModel && metric.value.includes('/')
          return (
            <div className={isModel ? 'ds-strip__item bb-readout__model' : 'ds-strip__item'} key={metric.label}>
              <dt className="ds-strip__label">{metric.label}</dt>
              <dd className="ds-strip__value">
                {chip ? <span className="ds-chip" title={metric.value}>{metric.value.replace(/^anthropic\//, '')}</span> : metric.value}
              </dd>
              <dd className="ds-strip__hint">{metric.hint}</dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}
