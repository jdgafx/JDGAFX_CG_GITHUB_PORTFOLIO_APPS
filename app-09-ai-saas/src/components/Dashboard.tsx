import { useMemo, useState } from 'react'
import type { Summary } from '../../netlify/shared/contract'
import { TRACE_STAGES } from '../lib/api'
import { buildWindow, observedDays, summarize, totalOf, type Series } from '../lib/analytics'
import { compact, shortDate } from '../lib/format'
import { useInsightRun, type RunStatus } from '../lib/insightRun'
import { HISTORY_DAYS, type NpmError } from '../lib/npm'
import { DEFAULT_NAMES, DEFAULT_WINDOW } from '../lib/presets'
import type { Release } from '../lib/releases'
import { buildSpikeEvidence, countSpikes } from '../lib/spikes'
import { useDownloads } from '../lib/useDownloads'
import { useResultFocus } from '../lib/useResultFocus'
import { useReleases } from '../lib/useReleases'
import AnswerCard from './AnswerCard'
import Header from './Header'
import InsightControls from './InsightControls'
import MoreCharts from './MoreCharts'
import Notices, { type Failure } from './Notices'
import PackageCards from './PackageCards'
import PackagePicker, { Presets } from './PackagePicker'
import ReadoutStrip from './ReadoutStrip'
import RunTrace from './RunTrace'
import SpikeStage from './SpikeStage'

/** One line of plain words for the status region. The verb matches the button that starts the run. */
function statusLine(status: RunStatus, openIndex: number, anyFailedStep: boolean, ready: boolean): string {
  if (status === 'running') {
    const next = openIndex >= 0 ? TRACE_STAGES[openIndex] : undefined
    return next ? `Explaining. Step ${openIndex + 1} of ${TRACE_STAGES.length}: ${next.name}.` : 'Explaining. Finishing the run.'
  }
  if (status === 'done') return anyFailedStep ? 'Explanation complete, with a failed check. See the trace.' : 'Explanation complete'
  if (status === 'failed') return 'Run failed. Explain spikes to try again.'
  if (status === 'stopped') return 'Stopped. The text shown is what arrived before you stopped.'
  return ready ? 'Ready. The model has not been called yet.' : 'Waiting for the downloads and the release history.'
}

export default function Dashboard() {
  const [names, setNames] = useState(DEFAULT_NAMES)
  const [days, setDays] = useState(DEFAULT_WINDOW)
  const [log, setLog] = useState(false)
  const [presetsOpen, setPresetsOpen] = useState(() => window.matchMedia('(min-width: 1000px)').matches)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const { outcomes, requestedEnd, loading, retry } = useDownloads(names, days)
  const history = useReleases(names)

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
    // Spike detection reads the whole year fetched, so a 30-day view still has weeks of baseline behind it.
    const year = series.length > 0 ? buildWindow(series, HISTORY_DAYS, requestedEnd) : null
    return { span, year, colorIndex, failures, summary: span ? summarize(span) : null }
  }, [outcomes, days, requestedEnd])
  const { span, year, colorIndex, failures, summary } = loaded

  const releaseLists = useMemo(() => {
    const lists = new Map<string, Release[] | null>()
    for (const [name, outcome] of history.outcomes) lists.set(name, 'releases' in outcome ? outcome.releases : null)
    return lists
  }, [history.outcomes])
  const releaseFailures = useMemo(
    () => (span ? span.series.map((s) => s.name).filter((name) => history.outcomes.has(name) && releaseLists.get(name) === null) : []),
    [span, history.outcomes, releaseLists],
  )
  const spikes = useMemo(() => (year && span ? buildSpikeEvidence(year, span.start, releaseLists) : []), [year, span, releaseLists])
  const spikeCounts = useMemo(() => (year && span ? countSpikes(year, span.start) : {}), [year, span])
  const spikesFound = Object.values(spikeCounts).reduce((sum, n) => sum + n, 0)

  // The model reads the figures and the evidence together, so the run waits until both have loaded.
  const evidenceSummary = useMemo<Summary | null>(
    () => (summary && !loading && !history.loading ? { ...summary, spikes, spikeCounts } : null),
    [summary, loading, history.loading, spikes, spikeCounts],
  )
  const run = useInsightRun(evidenceSummary)
  const ready = evidenceSummary !== null
  const start = () => {
    if (!window.matchMedia('(min-width: 1000px)').matches) setPresetsOpen(false)
    void run.generate()
  }
  const selectionTotal = span ? span.series.reduce((sum, s) => sum + totalOf(s.values), 0) : 0

  // On a narrow screen a finished run scrolls its result into view and focuses its heading (shared hook).
  useResultFocus(run.status)

  const openIndex = TRACE_STAGES.findIndex((stage) => !run.steps.some((step) => step.name === stage.name))
  const checkFailed = run.steps.some((step) => step.name === 'Check figures' && step.status === 'failed')
  const anyFailedStep = run.steps.some((step) => step.status === 'failed')
  const activeSpike = spikes.some((spike) => `${spike.name}|${spike.date}` === activeKey) ? activeKey : null

  return (
    <div className="ds-app" data-run={run.status}>
      <Header status={run.status} checkFailed={checkFailed} loading={loading && !span} />

      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
            <PackagePicker names={names} days={days} onNamesChange={setNames} onDaysChange={setDays} />
            <InsightControls run={run} ready={ready} onStart={start} />
            <p className="ds-help" role="status" aria-live="polite">
              {statusLine(run.status, openIndex, anyFailedStep, ready)}
            </p>
            <Presets names={names} onPick={setNames} open={presetsOpen} onOpenChange={setPresetsOpen} />
          </div>

          <div className="ds-run" aria-busy={loading}>
            <Notices
              failures={failures}
              allFailed={span === null && !loading}
              span={span}
              loading={loading}
              releaseFailures={releaseFailures}
              onRetry={retry}
              onRetryReleases={history.retry}
              onRemove={(name) => setNames((current) => current.filter((n) => n !== name))}
            />

            {span === null && loading && (
              <div role="status" className="ds-state ds-state--loading ds-run__stage">
                <span className="ds-state__mark" aria-hidden="true" />
                <p className="ds-state__title">Loading daily downloads</p>
                <p className="ds-state__body">Reading a year of counts for each package from npm.</p>
                <div className="ds-skeleton" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
            {span === null && !loading && failures.length === 0 && (
              <div role="status" className="ds-state ds-state--empty ds-run__stage">
                <span className="ds-state__mark" aria-hidden="true" />
                <p className="ds-state__title">No downloads in this window</p>
                <p className="ds-state__body">npm reports no downloads for these packages. Try a longer window or another package.</p>
              </div>
            )}

            {span && summary && (
              <>
                <div className={loading ? 'hub-data hub-data--stale ds-run__stage' : 'hub-data ds-run__stage'}>
                  <SpikeStage
                    span={span}
                    colorIndex={colorIndex}
                    spikes={spikes}
                    log={log}
                    onLogChange={setLog}
                    activeKey={activeSpike}
                    onActive={setActiveKey}
                    releasesLoading={history.loading}
                  />
                </div>
                <div className="hub-figures">
                  <dl className="ds-strip">
                    <div className="ds-strip__item">
                      <dt className="ds-strip__label">Selection total</dt>
                      <dd className="ds-strip__value">{compact(selectionTotal)}</dd>
                      <dd className="ds-strip__hint">downloads, all packages</dd>
                    </div>
                    <div className="ds-strip__item">
                      <dt className="ds-strip__label">Window</dt>
                      <dd className="ds-strip__value">{span.dates.length} days</dd>
                      <dd className="ds-strip__hint">
                        {shortDate(span.start)} to {shortDate(span.end)}, {span.end.slice(0, 4)}
                      </dd>
                    </div>
                    <div className="ds-strip__item">
                      <dt className="ds-strip__label">Days with data</dt>
                      <dd className="ds-strip__value">
                        {observedDays(span)} of {span.dates.length}
                      </dd>
                      <dd className="ds-strip__hint">reported by npm</dd>
                    </div>
                    <div className="ds-strip__item">
                      <dt className="ds-strip__label">Unusual days</dt>
                      <dd className="ds-strip__value">{spikesFound}</dd>
                      <dd className="ds-strip__hint">
                        {spikesFound > spikes.length ? `${spikes.length} shown (top 8 per package), ` : ''}
                        {spikes.filter((s) => s.releases.length > 0).length} with a release just before
                      </dd>
                    </div>
                  </dl>
                  <PackageCards packages={summary.packages} colorIndex={colorIndex} windowDays={summary.windowDays} />
                </div>
              </>
            )}

            <AnswerCard run={run} ready={ready} onStart={start} />
            <ReadoutStrip run={run} />
            <RunTrace steps={run.steps} status={run.status} partialAnswer={run.answer !== ''} />
            {span && summary && <MoreCharts packages={summary.packages} colorIndex={colorIndex} />}
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
