import { formatDate } from '../../shared/format'
import type { Day, PackageFacts, Release, ReleaseState, Rows, RunWindow } from '../../shared/types'

interface ChartsProps {
  names: string[]
  window: RunWindow
  rowsByName: Record<string, Rows>
  facts: PackageFacts[]
  releases: Record<string, Release[]>
  releaseState: Record<string, ReleaseState>
}

const W = 480
const H = 240
const M = { l: 60, r: 12, t: 12, b: 44 }
const PW = W - M.l - M.r
const PH = H - M.t - M.b

function windowDays(window: RunWindow): Day[] {
  const out: Day[] = []
  for (let t = Date.parse(`${window.start}T00:00:00Z`); t <= Date.parse(`${window.L}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

const shortDate = (day: Day) => formatDate(day).slice(0, -5)

function PackageChart({ name, index, window, rows, facts, releases, releaseState }: { name: string; index: number; window: RunWindow; rows: Rows; facts: PackageFacts | undefined; releases: Release[]; releaseState: ReleaseState }) {
  const days = windowDays(window)
  const n = days.length
  const noData = new Set(window.noData)
  const gaps = new Set(facts?.possibleGaps ?? [])
  const x = (i: number) => M.l + (n <= 1 ? 0 : (i * PW) / (n - 1))
  const step = n <= 1 ? PW : PW / (n - 1)
  const values = days.map(d => rows[d] ?? 0)
  const max = Math.max(1, ...values.filter((_, i) => !noData.has(days[i]!) && !gaps.has(days[i]!)))
  const y = (v: number) => M.t + PH * (1 - v / max)
  const base = M.t + PH
  const series = `ds-c-s${(index % 4) + 1}`

  // The line stops at a no-data day or a possible gap instead of falling to zero.
  const segments: string[][] = []
  let current: string[] = []
  days.forEach((d, i) => {
    if (noData.has(d) || gaps.has(d)) {
      if (current.length) segments.push(current)
      current = []
    } else current.push(`${x(i).toFixed(1)},${y(values[i]!).toFixed(1)}`)
  })
  if (current.length) segments.push(current)

  const at = (day: Day) => days.indexOf(day)
  const unusual = (facts?.unusual ?? []).filter(u => at(u.day) >= 0)
  const ticks = releases.filter(r => r.day >= window.start && r.day <= window.L && at(r.day) >= 0)
  const label = `${name}: daily downloads for ${window.name}, peak ${compact(max)}`

  return (
    <figure className="ds-chart">
      <div className="ds-chart__head">
        <figcaption className="ds-card__title">{name}</figcaption>
        <span className="ds-hint">Peak {compact(max)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <title>{label}</title>
        <line className="ds-c-grid" x1={M.l} x2={W - M.r} y1={M.t} y2={M.t} />
        <line className="ds-c-axis" x1={M.l} x2={W - M.r} y1={base} y2={base} />
        <text className="ds-c-tick" x={M.l - 6} y={M.t + 4} textAnchor="end">{compact(max)}</text>
        <text className="ds-c-tick" x={M.l - 6} y={base} textAnchor="end">0</text>
        <text className="ds-c-tick" x={M.l} y={H - 8} textAnchor="start">{shortDate(window.start)}</text>
        <text className="ds-c-tick" x={W - M.r} y={H - 8} textAnchor="end">{shortDate(window.L)}</text>
        {days.map((d, i) => (noData.has(d) ? <rect key={d} className="chart-nodata" x={x(i) - step / 2} y={M.t} width={step} height={PH} /> : null))}
        {segments.map((points, i) => (
          <polyline key={i} className={`ds-c-line ${series}`} points={points.join(' ')} />
        ))}
        {ticks.map(r => (
          <line key={`${r.day}-${r.version}`} className="chart-release" x1={x(at(r.day))} x2={x(at(r.day))} y1={base - 10} y2={base} />
        ))}
        {days.map((d, i) => (gaps.has(d) ? <circle key={d} className="chart-gap" cx={x(i)} cy={base} r={4} fill="none" /> : null))}
        {unusual.map(u => {
          const cx = x(at(u.day))
          const cy = y(u.value)
          return u.kind === 'spike' ? (
            <circle key={u.day} className={`chart-dot chart-dot--spike ${series}`} cx={cx} cy={cy} r={4.5}>
              <title>{`${u.day} spike`}</title>
            </circle>
          ) : (
            <path key={u.day} className={`chart-dot chart-dot--drop ${series}`} d={`M${cx - 5},${cy} L${cx},${cy - 5} L${cx + 5},${cy} L${cx},${cy + 5} Z`}>
              <title>{`${u.day} drop`}</title>
            </path>
          )
        })}
      </svg>
      {releaseState === 'failed' && <p className="ds-hint">Release history unavailable</p>}
    </figure>
  )
}

/** One chart per package, each on its own scale: daily downloads with the unusual days, releases, no-data days and gaps marked. */
export default function Charts({ names, window, rowsByName, facts, releases, releaseState }: ChartsProps) {
  const shown = names.filter(n => Object.hasOwn(rowsByName, n))
  return (
    <section className="charts" aria-label="Daily downloads">
      <div className="ds-grid-2">
        {shown.map(name => (
          <PackageChart
            key={name}
            name={name}
            index={names.indexOf(name)}
            window={window}
            rows={rowsByName[name]!}
            facts={facts.find(f => f.name === name)}
            releases={releases[name] ?? []}
            releaseState={releaseState[name] ?? 'failed'}
          />
        ))}
      </div>
      <ul className="ds-legend">
        <li>Line: daily downloads</li>
        <li>Filled dot: spike</li>
        <li>Diamond: drop</li>
        <li>Hollow ring: possible npm gap</li>
        <li>Tick on the axis: release</li>
        <li>Shaded: no data</li>
      </ul>
    </section>
  )
}
