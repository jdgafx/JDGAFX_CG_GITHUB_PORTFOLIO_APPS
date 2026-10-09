import type { SpikeEvidence } from '../../netlify/shared/contract'
import { RELEASE_LAG_DAYS } from '../../netlify/shared/contract'
import { averageRows, dailyRows, type DownloadWindow } from '../lib/analytics'
import { chartLayout } from '../lib/chartLayout'
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
          {spikes.length === 0 ? 'None found' : `${spikes.length} listed (top 8 per package), newest first`}
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

/** The two marker shapes, each glyph before its own label. */
function MarkerKey() {
  return (
    <ul className="ds-legend hub-keys" aria-label="Marker key">
      <li>
        <span className="hub-keys__dot" aria-hidden="true" />
        Release in the {RELEASE_LAG_DAYS} days before
      </li>
      <li>
        <span className="hub-keys__dot hub-keys__dot--open" aria-hidden="true" />
        No release nearby
      </li>
    </ul>
  )
}

/**
 * The hero: the daily chart with a marker on every unusual day, full width, and the list of what was found below it.
 * From 90 days the 7-day average is the solid line over a faint daily line. When one package is far larger than another
 * each gets its own row, so the small one's release-matched spikes are not flat on the floor.
 */
export default function SpikeStage({ span, colorIndex, spikes, log, onLogChange, activeKey, onActive, releasesLoading }: SpikeStageProps) {
  const { smooth, split } = chartLayout(span)
  const daily = dailyRows(span)
  const caption = smooth
    ? 'Solid line: 7-day average. Faint line: each day. Markers sit on the day\'s own count, with a thin stem to the average. A break is a day npm did not report.'
    : 'One line per package. A break is a day npm did not report.'
  const logSwitch = split ? null : (
    <label className="hub-log">
      <input type="checkbox" checked={log} onChange={(event) => onLogChange(event.target.checked)} />
      <span>Log scale</span>
    </label>
  )
  return (
    <section className="ds-run__stage hub-stage" aria-label="Daily downloads and unusual days">
      {split ? (
        <figure className="ds-chart hub-chart">
          <div className="ds-chart__head">
            <figcaption>
              <b>Daily downloads</b> <span className="ds-help">{caption} Each package has its own scale because they differ by more than 8 times.</span>
            </figcaption>
          </div>
          <div className="hub-rows">
            {span.series.map((s, i) => (
              <LineChart
                key={s.key}
                bare
                showX={i === span.series.length - 1}
                height={i === span.series.length - 1 ? 124 : 100}
                span={{ ...span, series: [s] }}
                rows={smooth ? averageRows({ ...span, series: [s] }) : daily}
                underlay={smooth ? daily : undefined}
                colorIndex={[colorIndex[i]]}
                log={false}
                spikes={spikes.filter((spike) => spike.name === s.name)}
                activeKey={activeKey}
                onActive={onActive}
              />
            ))}
          </div>
        </figure>
      ) : (
        <LineChart
          title="Daily downloads"
          caption={caption}
          headRight={logSwitch}
          span={span}
          rows={smooth ? averageRows(span) : daily}
          underlay={smooth ? daily : undefined}
          colorIndex={colorIndex}
          log={log}
          height={340}
          spikes={spikes}
          activeKey={activeKey}
          onActive={onActive}
        />
      )}
      <MarkerKey />
      <SpikeList spikes={spikes} span={span} colorIndex={colorIndex} activeKey={activeKey} onActive={onActive} releasesLoading={releasesLoading} />
      <p className="ds-help">
        {split
          ? 'Each row has its own vertical scale, so compare shapes, not heights.'
          : 'Log scale spaces the vertical axis by ratio, so a small package is not flattened beside a large one. It cannot draw zero, so a day with zero downloads shows as a gap.'}
      </p>
    </section>
  )
}
