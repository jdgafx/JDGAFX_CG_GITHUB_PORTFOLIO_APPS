import type { PackageFigures } from '../../netlify/shared/contract'
import { halfWindow } from '../../netlify/shared/contract'
import { compact, full, seriesColor, signedPercent } from '../lib/format'

interface PackageCardsProps {
  packages: PackageFigures[]
  /** Index of each package in the selection, so a card keeps its chart colour when a package failed to load. */
  colorIndex: number[]
  windowDays: number
}

/** The change line: an arrow, the signed percentage, and a word, so direction is never colour alone. */
function Change({ value }: { value: number | null }) {
  if (value === null) return <>not available</>
  const word = value === 0 ? 'flat' : value > 0 ? 'rising' : 'falling'
  const arrow = value === 0 ? '→' : value > 0 ? '▲' : '▼'
  return (
    <span className="ds-num">
      <span aria-hidden="true">{arrow} </span>
      {signedPercent(value)}, {word}
    </span>
  )
}

/** One card per package: its total and the figures worked out from the real daily counts. */
export default function PackageCards({ packages, colorIndex, windowDays }: PackageCardsProps) {
  const half = halfWindow(windowDays)
  return (
    <section className="ds-section" aria-label="Figures per package">
      <div className={`hub-cards hub-cards--n${Math.min(packages.length, 5)}`}>
        {packages.map((p, i) => (
          <article key={p.name} className="ds-card hub-card" aria-label={p.name}>
            <header className="hub-card__head">
              <span className="hub-swatch" style={{ background: seriesColor(colorIndex[i]) }} aria-hidden="true" />
              <h3 className="hub-card__name ds-mono">{p.name}</h3>
            </header>
            <p className="hub-card__total ds-num" title={`${full(p.total)} downloads`}>
              {compact(p.total)}
              <span className="hub-card__unit"> downloads</span>
            </p>
            <dl className="hub-card__rows">
              <div>
                <dt>Per day</dt>
                <dd className="ds-num">{full(p.avgPerDay)}</dd>
              </div>
              <div>
                <dt>
                  Last {half} days vs the {half} before
                </dt>
                <dd>
                  <Change value={p.changePct} />
                </dd>
              </div>
              <div>
                <dt>Weekend vs weekday</dt>
                <dd className="ds-num">{p.weekendPct === null ? 'not available' : `${p.weekendPct}% of a weekday`}</dd>
              </div>
            </dl>
            <div className="hub-share">
              <div className="hub-share__bar" aria-hidden="true">
                <span style={{ width: `${p.sharePct}%`, background: seriesColor(colorIndex[i]) }} />
              </div>
              <p className="hub-share__text ds-num">{p.sharePct.toFixed(1)}% of the selection</p>
            </div>
          </article>
        ))}
      </div>
      <p className="ds-help">
        Change compares per-day downloads in the latest half of the window with the half before it. Weekend vs weekday compares
        downloads per day. Share is a package's part of the selection's total.
      </p>
    </section>
  )
}
