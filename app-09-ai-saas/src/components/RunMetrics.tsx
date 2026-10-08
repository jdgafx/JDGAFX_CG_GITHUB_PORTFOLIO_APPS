import type { RunUsage } from '../lib/api'

interface RunMetricsProps {
  /** True once a run has finished or failed. Until then a line says when the readouts will appear. */
  ready: boolean
  totalMs: number | null
  usage: RunUsage | null
  model: string | null
}

// Every value is either measured or reported by the provider. A missing one reads "not reported", never a guess.
const count = (n: number | undefined) => (n === undefined ? 'not reported' : n.toLocaleString())
const cost = (usd: number | undefined) => (usd === undefined ? 'not reported' : `$${usd.toFixed(usd < 0.01 ? 6 : 4)}`)

export default function RunMetrics({ ready, totalMs, usage, model }: RunMetricsProps) {
  const items = [
    {
      label: 'Total latency',
      value: totalMs === null ? 'not reported' : `${totalMs.toLocaleString()} ms`,
      hint: 'Measured on the server',
      mono: false,
    },
    { label: 'Prompt tokens', value: count(usage?.prompt_tokens), hint: 'Reported by the provider', mono: false },
    { label: 'Completion tokens', value: count(usage?.completion_tokens), hint: 'Reported by the provider', mono: false },
    { label: 'Total tokens', value: count(usage?.total_tokens), hint: 'Reported by the provider', mono: false },
    { label: 'Cost (USD)', value: cost(usage?.cost), hint: 'Reported by the provider', mono: false },
    { label: 'Served model', value: model ?? 'not reported', hint: 'As named in the response', mono: true },
  ]

  return (
    <section className="ds-section" aria-labelledby="run-metrics-title">
      <div className="ds-section__head">
        <h2 id="run-metrics-title" className="ds-section__title">
          Run metrics
        </h2>
        <p className="ds-section__sub">Figures for this run only. A value the provider did not report shows as not reported.</p>
      </div>
      {ready ? (
        <dl className="ds-strip hub-metrics">
          {items.map((item) => (
            <div key={item.label} className="ds-strip__item">
              <dt className="ds-strip__label">{item.label}</dt>
              <dd className={item.mono ? 'ds-strip__value ds-mono' : 'ds-strip__value ds-num'}>{item.value}</dd>
              <dd className="ds-strip__hint">{item.hint}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="ds-empty">Run metrics appear when a run finishes or fails.</p>
      )}
    </section>
  )
}
