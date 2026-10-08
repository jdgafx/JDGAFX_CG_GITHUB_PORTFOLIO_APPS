import type { RunSummary } from '../lib/api'
import { NOT_REPORTED, formatCount, formatMs, formatUsd } from '../lib/format'

interface ReadoutStripProps {
  summary: RunSummary | null
}

interface ReadoutProps {
  label: string
  value: string
  hint?: string
  mono?: boolean
}

function Readout({ label, value, hint, mono = false }: ReadoutProps) {
  const missing = value === NOT_REPORTED
  const classes = ['ds-strip__value']
  // Mono is for the model ID only. A missing value is a label, so it stays in the body face.
  if (mono && !missing) classes.push('ds-mono')
  if (missing) classes.push('readout-missing')

  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className={classes.join(' ')}>{value}</dd>
      {hint && <dd className="ds-strip__hint">{hint}</dd>}
    </div>
  )
}

// The last run's figures, set as one row of readouts. Each one is a figure the provider
// sent or a plain "not reported".
export default function ReadoutStrip({ summary }: ReadoutStripProps) {
  return (
    <section className="ds-section" aria-labelledby="readout-title">
      <div className="ds-section__head">
        <h2 id="readout-title" className="ds-section__title">
          Readout
        </h2>
        <p className="ds-section__sub">Figures for the last run. A value marked not reported was not sent by the provider.</p>
      </div>

      {summary ? (
        <dl className="ds-strip">
          <Readout label="Total latency" value={formatMs(summary.totalMs)} />
          <Readout label="Prompt tokens" value={formatCount(summary.usage?.prompt_tokens)} />
          <Readout label="Completion tokens" value={formatCount(summary.usage?.completion_tokens)} />
          <Readout label="Total tokens" value={formatCount(summary.usage?.total_tokens)} />
          <Readout label="Cost (USD)" value={formatUsd(summary.usage?.cost)} hint="As reported by the provider" />
          <Readout label="Served model" value={summary.model ?? NOT_REPORTED} mono />
        </dl>
      ) : (
        <div className="ds-empty">Latency, tokens, cost and the served model appear here when a run finishes.</div>
      )}

      <p className="ds-help">One fixed vision model runs every analysis on the server. The served model is the one that answered.</p>
    </section>
  )
}
