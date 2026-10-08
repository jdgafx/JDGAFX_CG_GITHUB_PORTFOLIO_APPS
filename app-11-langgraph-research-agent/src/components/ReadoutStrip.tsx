import type { ResultFrame } from '../../netlify/shared/events'
import { costHint, count, milliseconds, usd } from '../lib/format'

interface ReadoutItemProps {
  label: string
  value: string
  hint: string
  mono?: boolean
}

function ReadoutItem({ label, value, hint, mono = false }: ReadoutItemProps) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className={mono ? 'ds-strip__value ds-mono' : 'ds-strip__value'}>{value}</dd>
      <dd className="ds-strip__hint">{hint}</dd>
    </div>
  )
}

interface ReadoutStripProps {
  result: ResultFrame | null
}

/** The figures for the whole run. Dashes until the answer is ready, so no partial total reads as final. */
export function ReadoutStrip({ result }: ReadoutStripProps) {
  const totals = result?.totals
  return (
    <section className="ds-section" aria-labelledby="totals-title">
      <div className="ds-section__head">
        <h2 id="totals-title" className="ds-section__title">
          Run totals
        </h2>
        <p className="ds-section__sub">Time, tokens, cost and models for the whole run. Filled in when the answer is ready.</p>
      </div>
      <dl className="ds-strip">
        <ReadoutItem label="Total time" value={totals ? milliseconds(totals.ms) : '—'} hint="Start to answer" />
        <ReadoutItem
          label="Total tokens"
          value={totals ? (totals.tokens === undefined ? 'not reported' : count(totals.tokens)) : '—'}
          hint="All model calls"
        />
        <ReadoutItem
          label="Total cost (USD)"
          value={totals ? (totals.cost === undefined ? 'not reported' : usd(totals.cost)) : '—'}
          hint={totals ? costHint(totals) : 'Reported, estimated or partial'}
        />
        <ReadoutItem
          label="Models used"
          value={result ? (result.models.length > 0 ? result.models.join(', ') : 'not reported') : '—'}
          hint="Named in the provider replies"
          mono
        />
      </dl>
    </section>
  )
}
