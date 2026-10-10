import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { SpikeEvidence } from '../../netlify/shared/contract'
import { logDomain, logRows, type ChartRow, type DownloadWindow } from '../lib/analytics'
import { linearAxis, linePath, logAxis, nearestMark, spreadLabels, tickIndices, type Axis } from '../lib/chartGeometry'
import { compact, full, seriesColor, shortDate } from '../lib/format'

/** The id a spike has on the chart and in the list, so the two can highlight each other. */
export const spikeKey = (spike: Pick<SpikeEvidence, 'name' | 'date'>): string => `${spike.name}|${spike.date}`

const TOP = 16
const LEFT = 52
/** Room right of the plot for names written at the line ends. Narrow screens rely on the legend alone. */
const LABEL_ROOM = 118
const WIDE_FROM = 480
/** How far from a marker a tap still picks it, in pixels. */
const TAP_RADIUS = 16
const X_AXIS_ROOM = 30

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

const numbers = (rows: ChartRow[], span: DownloadWindow): (number | null)[][] =>
  span.series.map((s) => rows.map((row) => (typeof row[s.key] === 'number' ? (row[s.key] as number) : null)))

interface LineChartProps {
  title?: string
  caption?: ReactNode
  /** Shown at the right of the heading row, for example the log switch. */
  headRight?: ReactNode
  span: DownloadWindow
  /** The solid lines. */
  rows: ChartRow[]
  /** When given, each day's own count is drawn as a faint line under `rows` (a smoothed main line over the daily values). */
  underlay?: ChartRow[]
  /** Index of each package in the selection, so colours match the cards and chips. */
  colorIndex: number[]
  log: boolean
  height: number
  spikes?: SpikeEvidence[]
  activeKey?: string | null
  onActive?: (key: string | null) => void
  /** One row of a small-multiples stack: no frame, legend or end labels. The package name is written inside the plot. */
  bare?: boolean
  /** False on every row but the last of a stack, so the date axis is drawn once. */
  showX?: boolean
}

/**
 * A line chart on the family chart frame: one solid line per package, names written at the line ends, gaps where npm
 * reported nothing, a log option, a reading for any day (pointer or arrow keys) and, when given, spike markers. A filled
 * circle marks a spike with a release just before it; a hollow diamond marks one with none, so the two differ by shape
 * as well as fill.
 */
export default function LineChart({ title, caption, headRight, span, rows, underlay, colorIndex, log, height, spikes = [], activeKey = null, onActive, bare = false, showX = true }: LineChartProps) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const wide = !bare && width >= WIDE_FROM
  const right = wide ? LABEL_ROOM : 10
  const plotW = Math.max(40, width - LEFT - right)
  const bottom = height - (showX ? X_AXIS_ROOM : 6)
  const n = span.dates.length

  const mainRows = log ? logRows(rows) : rows
  const dayRows = underlay ? (log ? logRows(underlay) : underlay) : null
  const domain = log ? logDomain([...mainRows, ...(dayRows ?? [])]) : null
  const columns = numbers(mainRows, span)
  const dayColumns = dayRows ? numbers(dayRows, span) : null
  const max = Math.max(0, ...[...columns, ...(dayColumns ?? [])].flatMap((c) => c.filter((v): v is number => v !== null)))
  const axis: Axis = domain ? logAxis(domain, TOP, bottom) : linearAxis(max, TOP, bottom, bare ? 2 : 4)
  const xs = span.dates.map((_, i) => LEFT + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW))

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

  // Markers sit on the day's own count, whether or not the line drawn over it is smoothed.
  const markColumns = dayColumns ?? columns
  const marks = spikes.flatMap((spike) => {
    const si = span.series.findIndex((s) => s.name === spike.name)
    const i = span.dates.indexOf(spike.date)
    const y = si < 0 || i < 0 || markColumns[si][i] === null ? null : axis.y(markColumns[si][i] as number)
    // With a smoothed line, a thin stem joins the marker on the day's own count to the average line under or over it.
    const ay = dayColumns && columns[si][i] !== null ? axis.y(columns[si][i] as number) : null
    return y === null ? [] : [{ spike, si, x: xs[i], y, ay }]
  })
  const active = marks.find((m) => spikeKey(m.spike) === activeKey)

  const label = title ?? span.series.map((s) => s.name).join(', ')
  const summary = `${label} for ${span.series.map((s) => s.name).join(', ')}, ${span.start} to ${span.end}${spikes.length > 0 ? `. ${spikes.length} unusual ${spikes.length === 1 ? 'day is' : 'days are'} marked` : ''}.`
  const tipLeft = hover === null ? 0 : xs[hover]
  const tag = active ? `${shortDate(active.spike.date)} +${active.spike.sizePct}%` : ''
  const tagW = tag.length * 7.4 + 18

  const plot = (
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
            return y === null ? null : <line key={t} x1={LEFT} x2={LEFT + plotW} y1={y} y2={y} />
          })}
        </g>
        <line className="ds-c-axis" x1={LEFT} x2={LEFT + plotW} y1={bottom} y2={bottom} />
        <g className="ds-c-tick">
          {axis.ticks.map((t) => {
            const y = axis.y(t)
            return y === null ? null : (
              <text key={t} x={LEFT - 8} y={y + 4} textAnchor="end">
                {compact(t)}
              </text>
            )
          })}
          {showX &&
            tickIndices(n, plotW, 84).map((i, k, all) => (
              <text key={i} x={xs[i]} y={height - 8} textAnchor={k === 0 ? 'start' : k === all.length - 1 ? 'end' : 'middle'}>
                {shortDate(span.dates[i])}
              </text>
            ))}
        </g>

        {dayColumns?.map((c, k) => (
          <path key={`day-${span.series[k].key}`} className="hub-faint" style={{ stroke: seriesColor(colorIndex[k]) }} d={linePath(xs, c, axis)} />
        ))}
        {columns.map((c, k) => (
          <path key={span.series[k].key} className={`ds-c-line ${seriesClass(colorIndex[k])}`} style={{ stroke: seriesColor(colorIndex[k]) }} d={linePath(xs, c, axis)} />
        ))}

        {bare && (
          <text className="ds-c-label hub-rowlabel" style={{ fill: seriesColor(colorIndex[0]) }} x={LEFT + 6} y={TOP + 10}>
            {span.series[0].name}
          </text>
        )}
        {wide &&
          ends.map((end, k) =>
            end === null ? null : (
              <g key={span.series[k].key}>
                {labelY[k].moved && (
                  <line className="ds-c-grid" style={{ stroke: seriesColor(colorIndex[k]) }} x1={xs[end.i]} x2={LEFT + plotW + 6} y1={wanted[k]} y2={labelY[k].y - 4} />
                )}
                <text className="ds-c-label" style={{ fill: seriesColor(colorIndex[k]) }} x={LEFT + plotW + 8} y={labelY[k].y + 4}>
                  {span.series[k].name.length > 16 ? `${span.series[k].name.slice(0, 15)}…` : span.series[k].name}
                </text>
              </g>
            ),
          )}

        {hover !== null && <line className="ds-c-axis" x1={xs[hover]} x2={xs[hover]} y1={TOP} y2={bottom} strokeDasharray="3 3" />}
        {active && <line className="hub-guide" x1={active.x} x2={active.x} y1={TOP} y2={bottom} />}

        <rect
          x={LEFT}
          y={TOP}
          width={plotW}
          height={bottom - TOP}
          fill="transparent"
          onPointerMove={move}
          onPointerLeave={() => setHover(null)}
          onClick={(event) => {
            // Markers sit a pixel or less apart on a long window, so a tap picks the nearest one to the finger.
            const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
            if (!box) return
            const best = nearestMark(marks.map((m) => ({ x: m.x, y: m.y, key: spikeKey(m.spike) })), event.clientX - box.left, event.clientY - box.top, TAP_RADIUS)
            if (best) onActive?.(best === activeKey ? null : best)
          }}
        />

        {marks.map(({ spike, si, x, y, ay }) =>
          ay !== null && Math.abs(ay - y) > 6 ? (
            <line key={`stem-${spikeKey(spike)}`} className="hub-stem" style={{ stroke: seriesColor(colorIndex[si]) }} x1={x} x2={x} y1={y} y2={ay} />
          ) : null,
        )}
        {marks.map(({ spike, si, x, y }) => {
          const key = spikeKey(spike)
          const matched = spike.releases.length > 0
          const text = `${spike.name}, ${shortDate(spike.date)}, ${spike.sizePct}% above the usual, ${matched ? `release ${spike.releases[0].version} just before` : 'no release nearby'}`
          const toggle = () => onActive?.(key === activeKey ? null : key)
          return (
            <g
              key={key}
              className={`hub-spike ${seriesClass(colorIndex[si])}${key === activeKey ? ' hub-spike--active' : ''}`}
              pointerEvents="none"
              style={{ color: seriesColor(colorIndex[si]) }}
              transform={`translate(${x} ${y})`}
              tabIndex={0}
              role="button"
              aria-pressed={key === activeKey}
              aria-label={text}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  toggle()
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
          <g transform={`translate(${Math.min(Math.max(active.x, LEFT + tagW / 2), LEFT + plotW - tagW / 2)} ${Math.max(active.y - 26, TOP + 2)})`}>
            <rect className="hub-pill" x={-tagW / 2} y="-13" width={tagW} height="22" rx="11" />
            <text className="hub-pill__text" textAnchor="middle" y="2">
              {tag}
            </text>
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="hub-tip" style={{ left: tipLeft, transform: tipLeft > width / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }} aria-hidden="true">
          <b>{shortDate(span.dates[hover])}</b>
          {span.series.map((s, k) => {
            const day = (dayColumns ?? columns)[k][hover]
            const avg = dayColumns ? columns[k][hover] : null
            return (
              <span key={s.key}>
                <span className="hub-swatch" style={{ background: seriesColor(colorIndex[k]) }} />
                <span className="ds-mono">{s.name}</span>{' '}
                <span className="ds-num">{day === null ? 'not reported' : full(day)}</span>
                {avg !== null && <span className="ds-help"> avg {compact(avg)}</span>}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )

  if (bare) return plot
  return (
    <figure className="ds-chart hub-chart">
      <div className="ds-chart__head">
        <figcaption>
          <b>{title}</b> <span className="ds-help">{caption}</span>
        </figcaption>
        {headRight}
      </div>
      <ul className="ds-legend hub-legend" aria-hidden="true">
        {span.series.map((s, i) => (
          <li key={s.key}>
            <span className="hub-swatch" style={{ background: seriesColor(colorIndex[i]) }} />
            <span className="ds-mono">{s.name}</span>
          </li>
        ))}
      </ul>
      {plot}
    </figure>
  )
}
