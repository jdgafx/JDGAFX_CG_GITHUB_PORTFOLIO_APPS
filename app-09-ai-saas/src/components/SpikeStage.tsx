import type { SpikeEvidence } from '../../netlify/shared/contract'
import { RELEASE_LAG_DAYS } from '../../netlify/shared/contract'
import { dailyRows, type DownloadWindow } from '../lib/analytics'
import { compact, seriesColor, shortDate } from '../lib/format'
import LineChart, { spikeKey } from './LineChart'

interface SpikeListProps {
  spikes: SpikeEvidence[]
  span: DownloadWindow
  colorIndex: number[]
  activeKey: string | null
  onActive: (key: string | null) => void
  /** True while the registry is still being read, so the list says the releases are not in yet. */
  releasesLoading: boolean
}

function Releases({ spike, loading }: { spike: SpikeEvidence; loading: boolean }) {
  if (loading) return <span className="hub-spike-row__none">Reading release history…</span>
  if (!spike.releasesKnown) return <span className="hub-spike-row__none">Release history unavailable</span>
  if (spike.releases.length === 0) return <span className="hub-spike-row__none">No release nearby</span>
  return (
    <span className="ds-chips">
      {spike.releases.map((r) => (
        <span key={r.version} className="ds-chip" title={`${r.kind} release ${r.version}, published ${r.date}`}>
          {r.version}
          <span className={`hub-kind hub-kind--${r.kind}`}>{r.kind}</span>
          <span className="ds-chip--muted">{shortDate(r.date)}</span>
        </span>
      ))}
      {spike.moreReleases > 0 && <span className="ds-chip ds-chip--muted">+{spike.moreReleases} more</span>}
    </span>
  )
}

/** The evidence behind the markers: one row per unusual day, newest first, with size against the usual level and the releases just before. */
function SpikeList({ spikes, span, colorIndex, activeKey, onActive, releasesLoading }: SpikeListProps) {
  const rows = [...spikes].reverse()
  return (
    <section className="hub-spikes" aria-label="Unusual days">
      <div className="hub-spikes__head">
        <b>Unusual days</b>
        <span className="ds-help">
          {spikes.length === 0 ? 'None found' : `${spikes.length} found, newest first`}
        </span>
      </div>
      {spikes.length === 0 ? (
        <p className="ds-help">
          No day in this window ran far above the usual level for its weekday, so there is nothing to match to releases.
        </p>
      ) : (
        <ul className="hub-spikes__list">
          {rows.map((spike) => {
            const key = spikeKey(spike)
            const index = colorIndex[span.series.findIndex((s) => s.name === spike.name)] ?? 0
            return (
              <li key={key}>
                <button
                  type="button"
                  className={key === activeKey ? 'hub-spike-row hub-spike-row--active' : 'hub-spike-row'}
                  aria-pressed={key === activeKey}
                  onClick={() => onActive(key === activeKey ? null : key)}
                >
                  <span className="hub-spike-row__top">
                    <span className="hub-swatch" style={{ background: seriesColor(index) }} aria-hidden="true" />
                    <span className="ds-mono hub-spike-row__name">{spike.name}</span>
                    <span className="ds-num">{shortDate(spike.date)}</span>
                  </span>
                  <span className="hub-spike-row__size ds-num">
                    +{spike.sizePct}% <span className="ds-help">{compact(spike.downloads)} against {compact(spike.baseline)} usual</span>
                  </span>
                  <Releases spike={spike} loading={releasesLoading} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

interface SpikeStageProps {
  span: DownloadWindow
  colorIndex: number[]
  spikes: SpikeEvidence[]
  log: boolean
  onLogChange: (log: boolean) => void
  activeKey: string | null
  onActive: (key: string | null) => void
  releasesLoading: boolean
}

/** The hero: the daily chart with a marker on every unusual day, and the list of what was found beside it. */
export default function SpikeStage({ span, colorIndex, spikes, log, onLogChange, activeKey, onActive, releasesLoading }: SpikeStageProps) {
  return (
    <section className="ds-run__stage hub-stage" aria-label="Daily downloads and unusual days">
      <LineChart
        title="Daily downloads"
        caption="One line per package. A broken line is a day npm did not report."
        headRight={
          <label className="hub-log">
            <input type="checkbox" checked={log} onChange={(event) => onLogChange(event.target.checked)} />
            <span>Log scale</span>
          </label>
        }
        span={span}
        rows={dailyRows(span)}
        colorIndex={colorIndex}
        log={log}
        height={320}
        spikes={spikes}
        activeKey={activeKey}
        onActive={onActive}
      />
      <div className="hub-stage__aside">
        <p className="ds-help hub-keys">
          <span className="hub-keys__dot" aria-hidden="true" /> Release in the {RELEASE_LAG_DAYS} days before
          <span className="hub-keys__dot hub-keys__dot--open" aria-hidden="true" /> No release nearby
        </p>
        <SpikeList
          spikes={spikes}
          span={span}
          colorIndex={colorIndex}
          activeKey={activeKey}
          onActive={onActive}
          releasesLoading={releasesLoading}
        />
        <p className="ds-help">
          Log scale spaces the vertical axis by ratio, so a small package is not flattened beside a large one. It cannot
          draw zero, so a day with zero downloads shows as a gap.
        </p>
      </div>
    </section>
  )
}
