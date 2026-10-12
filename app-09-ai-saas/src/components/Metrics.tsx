import { growthPercent } from '../../shared/aggregates'
import { fixedDecimal, formatCount } from '../../shared/format'
import type { PackageFacts, RunWindow } from '../../shared/types'

/** Change in average per day with downloads, past month vs the month before, as a signed percent to one decimal. */
export function changeText(facts: PackageFacts): string {
  const value = growthPercent(facts.aggregates.growth)
  return value === null ? 'n/a' : `${value}%`
}

/** Per-package figures and the cross-package ones, all written by code from the aggregates. */
export default function Metrics({ facts, window }: { facts: PackageFacts[]; window: RunWindow }) {
  const combined = facts.reduce((sum, f) => sum + f.aggregates.windowTotal, 0n)
  const several = facts.length >= 2
  return (
    <section className="metrics" aria-label="Figures per package">
      {several && (
        <p className="metrics__combined">
          <span>Combined total</span>
          <strong className="ds-num">{formatCount(combined)}</strong>
        </p>
      )}
      <div className="ds-grid-2">
        {facts.map((f, i) => (
          <article key={f.name} className="metrics__package ds-card">
            <h3 className="ds-card__title">
              <span className={`metrics__swatch ds-c-s${(i % 4) + 1}`} aria-hidden="true" />
              {f.name}
            </h3>
            <dl className="ds-kv">
              <dt>Window total</dt>
              <dd>{formatCount(f.aggregates.windowTotal)}</dd>
              <dt>Average per day</dt>
              <dd>{formatCount(fixedDecimal(f.aggregates.windowTotal, BigInt(window.days), 0))}</dd>
              <dt title="Change in average per day with downloads, past month vs the month before, days without downloads left out">Change</dt>
              <dd>{changeText(f)}</dd>
              <dt>Unusual days</dt>
              <dd>{f.unusual.length}</dd>
              {several && (
                <>
                  <dt>Share of combined total</dt>
                  <dd>{combined === 0n ? 'n/a' : `${fixedDecimal(f.aggregates.windowTotal * 100n, combined, 1)}%`}</dd>
                </>
              )}
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
}
