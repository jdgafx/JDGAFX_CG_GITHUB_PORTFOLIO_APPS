import { useMemo, useState } from 'react'
import { buildWindow, observedDays, summarize, totalOf, type Series } from '../lib/analytics'
import { compact, longDate, shortDate } from '../lib/format'
import { useInsightRun } from '../lib/insightRun'
import { type NpmError } from '../lib/npm'
import { DEFAULT_NAMES, DEFAULT_WINDOW } from '../lib/presets'
import { useDownloads } from '../lib/useDownloads'
import AppShell from './AppShell'
import DataNotices, { type Failure } from './DataNotices'
import DownloadCharts from './DownloadCharts'
import InsightControls from './InsightControls'
import InsightsPanel from './InsightsPanel'
import PackageCards from './PackageCards'
import PackagePicker from './PackagePicker'

/** The dates of unreported days, as a short list: the first few, then how many more. */
function listDates(dates: string[]): string {
  const shown = dates.slice(0, 4).map(shortDate).join(', ')
  return dates.length > 4 ? `${shown} and ${dates.length - 4} more` : shown
}

export default function Dashboard() {
  const [names, setNames] = useState(DEFAULT_NAMES)
  const [days, setDays] = useState(DEFAULT_WINDOW)
  const { outcomes, requestedEnd, loading, retry } = useDownloads(names, days)

  // A package keeps the colour of its place in the selection, even when an earlier one failed to load.
  const loaded = useMemo(() => {
    const series: Series[] = []
    const colorIndex: number[] = []
    const failures: Failure[] = []
    outcomes.forEach((outcome, index) => {
      if ('days' in outcome) {
        series.push({ key: `p${index}`, name: outcome.name, days: outcome.days })
        colorIndex.push(index)
      } else {
        failures.push({ name: outcome.name, error: outcome.error as NpmError })
      }
    })
    const span = series.length > 0 ? buildWindow(series, days, requestedEnd) : null
    return { span, colorIndex, failures, summary: span ? summarize(span) : null }
  }, [outcomes, days, requestedEnd])

  const { span, colorIndex, failures, summary } = loaded
  const run = useInsightRun(loading ? null : summary)
  const selectionTotal = span ? span.series.reduce((sum, s) => sum + totalOf(s.values), 0) : 0

  return (
    <AppShell
      purpose="Compare npm packages by real daily downloads, with an AI analysis of the figures."
      badge={<span className="ds-badge ds-badge--success">Live npm data</span>}
    >
      <div className="ds-bench hub-bench">
        <div className="hub-side">
          <PackagePicker names={names} days={days} onNamesChange={setNames} onDaysChange={setDays} />
          <InsightControls run={run} ready={summary !== null && !loading} />
        </div>

        <section className="ds-section hub-figures" aria-labelledby="figures-title" aria-busy={loading}>
          <div className="ds-section__head">
            <h2 id="figures-title" className="ds-section__title">
              Download figures
            </h2>
            <p className="ds-section__sub">
              Worked out in your browser from npm's daily counts. The AI analysis reads these figures, not the daily numbers.
            </p>
          </div>

          <DataNotices
            failures={failures}
            allFailed={span === null && !loading}
            onRetry={retry}
            onRemove={(name) => setNames((current) => current.filter((n) => n !== name))}
          />

          {span === null && loading && (
            <p role="status" className="ds-empty">
              Loading daily downloads from npm…
            </p>
          )}
          {span === null && !loading && failures.length === 0 && (
            <p role="status" className="ds-empty">
              npm reports no downloads for these packages in this window.
            </p>
          )}

          {span && summary && (
            <div className={loading ? 'hub-data hub-data--stale' : 'hub-data'}>
              <p role="status" className="hub-status">
                {loading
                  ? 'Updating from npm…'
                  : `Showing ${longDate(span.start)} to ${longDate(span.end)}${
                      span.lagDays > 0
                        ? `, the latest day npm has published. The ${span.lagDays === 1 ? 'day' : `${span.lagDays} days`} after it ${span.lagDays === 1 ? 'is' : 'are'} not published yet.`
                        : '.'
                    }`}
              </p>
              <dl className="ds-strip hub-strip">
                <div className="ds-strip__item">
                  <dt className="ds-strip__label">Selection total</dt>
                  <dd className="ds-strip__value ds-num">{compact(selectionTotal)}</dd>
                  <dd className="ds-strip__hint">downloads, all packages</dd>
                </div>
                <div className="ds-strip__item">
                  <dt className="ds-strip__label">Dates shown</dt>
                  <dd className="ds-strip__value ds-num">
                    {shortDate(span.start)} – {shortDate(span.end)}
                  </dd>
                  <dd className="ds-strip__hint ds-num">
                    {span.start} to {span.end}
                  </dd>
                </div>
                <div className="ds-strip__item">
                  <dt className="ds-strip__label">Days with data</dt>
                  <dd className="ds-strip__value ds-num">
                    {observedDays(span)} of {span.dates.length}
                  </dd>
                  <dd className="ds-strip__hint">reported by npm</dd>
                </div>
              </dl>
              {span.gapDates.length > 0 && (
                <p className="ds-notice hub-gap">
                  npm reported no downloads for any package on {listDates(span.gapDates)}. Those days are left out of
                  the averages and the change figures, and show as gaps in the charts.
                </p>
              )}
              <PackageCards packages={summary.packages} colorIndex={colorIndex} windowDays={summary.windowDays} />
              <p className="ds-help">
                Change compares per-day downloads in the latest half of the window with the half before it. Weekend vs
                weekday compares downloads per day. Share is a package's part of the selection's total.
              </p>
            </div>
          )}
        </section>

        <InsightsPanel run={run} />
        {span && summary && <DownloadCharts span={span} packages={summary.packages} colorIndex={colorIndex} />}
      </div>
    </AppShell>
  )
}
