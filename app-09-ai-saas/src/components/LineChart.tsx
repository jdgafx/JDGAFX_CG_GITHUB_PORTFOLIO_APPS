import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { SpikeEvidence } from '../../netlify/shared/contract'
import { logDomain, logRows, type ChartRow, type DownloadWindow } from '../lib/analytics'
import { linearAxis, linePath, logAxis, spreadLabels, tickIndices, type Axis } from '../lib/chartGeometry'
import { compact, full, seriesColor, shortDate } from '../lib/format'

/** The id a spike has on the chart and in the list, so the two can highlight each other. */
export const spikeKey = (spike: Pick<SpikeEvidence, 'name' | 'date'>): string => `${spike.name}|${spike.date}`

const MARGIN = { top: 16, left: 52, bottom: 30 }
/** Room right of the plot for names written at the line ends. Narrow screens use a legend instead. */
const LABEL_ROOM = 118
const WIDE_FROM = 480

/** Line styles after the first two series, so no series is told apart by hue alone. */
const DASHES = [undefined, undefined, '8 4', '2 4', '10 3 2 3']
const seriesClass = (index: number): string => (index % 5 === 4 ? 'hub-c-s5' : `ds-c-s${(index % 5) + 1}`)

/** The width of an element, kept current as it resizes. The first value is a desktop guess for the first paint. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(720)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const watch = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    watch.observe(node)
    setWidth(Math.round(node.getBoundingClientRect().width) || 720)
    return () => watch.disconnect()
  }, [])
  return [ref, width]
}

interface LineChartProps {
  title: string
  caption: ReactNode
  /** Shown at the right of the heading row, for example the log switch. */
  headRight?: ReactNode
  span: DownloadWindow
  rows: ChartRow[]
  /** Index of each package in the selection, so colours match the cards and chips. */
  colorIndex: number[]
  log: boolean
  height: number
  spikes?: SpikeEvidence[]
  activeKey?: string | null
  onActive?: (key: string | null) => void
}

/**
 * A line chart on the family chart frame: one line per package, names written at the line ends, gaps where npm
 * reported nothing, a log option, a reading for any day (pointer or arrow keys) and, when given, spike markers.
 * A filled marker has a release just before it; a hollow one has none.
 */
export default function LineChart({ title, caption, headRight, span, rows, colorIndex, log, height, spikes = [], activeKey = null, onActive }: LineChartProps) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const wide = width >= WIDE_FROM
  const right = wide ? LABEL_ROOM : 10
  const left = MARGIN.left
  const plotW = Math.max(40, width - left - right)
  const bottom = height - MARGIN.bottom
  const n = span.dates.length

  const data = log ? logRows(rows) : rows
  const domain = log ? logDomain(data) : null
  const columns = span.series.map((s) => data.map((row) => (typeof row[s.key] === 'number' ? (row[s.key] as number) : null)))
  const max = Math.max(0, ...columns.flatMap((c) => c.filter((v): v is number => v !== null)))
  const axis: Axis = domain ? logAxis(domain, MARGIN.top, bottom) : linearAxis(max, MARGIN.top, bottom)
  const xs = span.dates.map((_, i) => left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW))

  const ends = columns.map((c) => {
    const i = c.findLastIndex((v) => v !== null)
    return i < 0 ? null : { i, y: axis.y(c[i] as number) }
  })
  const wanted = ends.map((e) => e?.y ?? bottom)
  const labelY = spreadLabels(wanted)

  const move = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - box.left) / box.width
    setHover(Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1)))))
  }
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const step = event.key === 'ArrowLeft' ? -1 : 1
      setHover((current) => Math.min(n - 1, Math.max(0, (current ?? (step < 0 ? n : -1)) + step)))
    } else if (event.key === 'Escape') setHover(null)
  }

  const marks = spikes.flatMap((spike) => {
    const si = span.series.findIndex((s) => s.name === spike.name)
    const i = span.dates.indexOf(spike.date)
    const y = si < 0 || i < 0 || columns[si][i] === null ? null : axis.y(columns[si][i] as number)
    return y === null ? [] : [{ spike, si, x: xs[i], y }]
  })
  const active = marks.find((m) => spikeKey(m.spike) === activeKey)

  const summary = `${title} for ${span.series.map((s) => s.name).join(', ')}, ${span.start} to ${span.end}${spikes.length > 0 ? `. ${spikes.length} unusual ${spikes.length === 1 ? 'day is' : 'days are'} marked` : ''}.`
  const tipLeft = hover === null ? 0 : xs[hover]

  return (
    <figure className="ds-chart hub-chart">
      <div className="ds-chart__head">
        <figcaption>
          <b>{title}</b> <span className="ds-help">{caption}</span>
        </figcaption>
        {headRight}
      </div>
      {!wide && (
        <ul className="ds-legend" aria-hidden="true">
          {span.series.map((s, i) => (
            <li key={s.key}>
              <span className="hub-swatch" style={{ background: seriesColor(colorIndex[i]) }} />
              <span className="ds-mono">{s.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div
        ref={ref}
        className="hub-plot"
        tabIndex={0}
        role="group"
        aria-label={`${summary} Use the left and right arrow keys to read one day at a time.`}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation">
          <g className="ds-c-grid">
            {axis.ticks.map((t) => {
              const y = axis.y(t)
              return y === null ? null : <line key={t} x1={left} x2={left + plotW} y1={y} y2={y} />
            })}
          </g>
          <line className="ds-c-axis" x1={left} x2={left + plotW} y1={bottom} y2={bottom} />
          <g className="ds-c-tick">
            {axis.ticks.map((t) => {
              const y = axis.y(t)
              return y === null ? null : (
                <text key={t} x={left - 8} y={y + 4} textAnchor="end">
                  {compact(t)}
                </text>
              )
            })}
            {tickIndices(n, plotW, 84).map((i, k, all) => (
              <text key={i} x={xs[i]} y={height - 8} textAnchor={k === 0 ? 'start' : k === all.length - 1 ? 'end' : 'middle'}>
                {shortDate(span.dates[i])}
              </text>
            ))}
          </g>

          {columns.map((c, k) => (
            <path
              key={span.series[k].key}
              className={`ds-c-line ${seriesClass(colorIndex[k])}`}
              style={{ stroke: seriesColor(colorIndex[k]) }}
              strokeDasharray={DASHES[colorIndex[k] % 5]}
              d={linePath(xs, c, axis)}
            />
          ))}

          {wide &&
            ends.map((end, k) =>
              end === null ? null : (
                <g key={span.series[k].key}>
                  {labelY[k].moved && (
                    <line className="ds-c-grid" style={{ stroke: seriesColor(colorIndex[k]) }} x1={xs[end.i]} x2={left + plotW + 6} y1={wanted[k]} y2={labelY[k].y - 4} />
                  )}
                  <text
                    className="ds-c-label"
                    style={{ fill: seriesColor(colorIndex[k]) }}
                    x={left + plotW + 8}
                    y={labelY[k].y + 4}
                  >
                    {span.series[k].name.length > 16 ? `${span.series[k].name.slice(0, 15)}…` : span.series[k].name}
                  </text>
                </g>
              ),
            )}

          {hover !== null && <line className="ds-c-axis" x1={xs[hover]} x2={xs[hover]} y1={MARGIN.top} y2={bottom} strokeDasharray="3 3" />}
          {active && <line className="hub-guide" x1={active.x} x2={active.x} y1={MARGIN.top} y2={bottom} />}

          <rect x={left} y={MARGIN.top} width={plotW} height={bottom - MARGIN.top} fill="transparent" onPointerMove={move} onPointerLeave={() => setHover(null)} />

          {marks.map(({ spike, si, x, y }) => {
            const key = spikeKey(spike)
            const matched = spike.releases.length > 0
            const label = `${spike.name}, ${shortDate(spike.date)}, ${spike.sizePct}% above the usual, ${matched ? `release ${spike.releases[0].version} just before` : 'no release nearby'}`
            return (
              <g
                key={key}
                className={`hub-spike ${seriesClass(colorIndex[si])}${key === activeKey ? ' hub-spike--active' : ''}`}
                style={{ color: seriesColor(colorIndex[si]) }}
                transform={`translate(${x} ${y})`}
                tabIndex={0}
                role="button"
                aria-pressed={key === activeKey}
                aria-label={label}
                onClick={() => onActive?.(key === activeKey ? null : key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onActive?.(key === activeKey ? null : key)
                  }
                }}
              >
                <circle r="11" fill="transparent" stroke="none" />
                {matched ? (
                  <circle className="hub-spike__dot" r="5.5" />
                ) : (
                  <rect className="hub-spike__dot hub-spike__dot--open" x="-5" y="-5" width="10" height="10" transform="rotate(45)" />
                )}
              </g>
            )
          })}
          {active && (
            <g className="hub-tag" transform={`translate(${Math.min(Math.max(active.x, left + 62), left + plotW - 62)} ${Math.max(active.y - 20, MARGIN.top + 10)})`}>
              <text className="ds-c-label" textAnchor="middle">
                {shortDate(active.spike.date)} +{active.spike.sizePct}%
              </text>
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="hub-tip" style={{ left: tipLeft, transform: tipLeft > width / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }} aria-hidden="true">
            <b>{shortDate(span.dates[hover])}</b>
            {span.series.map((s, k) => (
              <span key={s.key}>
                <span className="hub-swatch" style={{ background: seriesColor(colorIndex[k]) }} />
                <span className="ds-mono">{s.name}</span> <span className="ds-num">{columns[k][hover] === null ? 'not reported' : full(columns[k][hover] as number)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}
