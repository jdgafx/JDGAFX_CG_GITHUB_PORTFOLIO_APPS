import { useState } from 'react'
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PackageFigures } from '../../netlify/shared/contract'
import { AVERAGE_SPAN, averageRows, dailyRows, logDomain, logRows, type DownloadWindow } from '../lib/analytics'
import { compact, full, seriesColor, shortDate } from '../lib/format'

interface DownloadChartsProps {
  span: DownloadWindow
  packages: PackageFigures[]
  /** Index of each package in the selection, so colours match the cards and chips. */
  colorIndex: number[]
}

const tooltipProps = {
  contentStyle: {
    background: 'var(--ds-surface, #ffffff)',
    border: '1px solid var(--ds-border, #d3dae4)',
    borderRadius: 'var(--ds-radius-sm, 4px)',
    boxShadow: 'var(--ds-shadow, none)',
    fontSize: 12,
  },
  labelStyle: { color: 'var(--ds-text-muted, #56637a)' },
  itemStyle: { color: 'var(--ds-text, #0e1b2b)' },
}

function Legend({ span, colorIndex }: { span: DownloadWindow; colorIndex: number[] }) {
  return (
    <ul className="hub-legend" aria-hidden="true">
      {span.series.map((s, i) => (
        <li key={s.key}>
          <span className="hub-swatch" style={{ background: seriesColor(colorIndex[i]) }} />
          <span className="ds-mono">{s.name}</span>
        </li>
      ))}
    </ul>
  )
}

interface LinesProps {
  span: DownloadWindow
  colorIndex: number[]
  rows: ReturnType<typeof dailyRows>
  label: string
  log: boolean
}

/** One line per package over the window. A null value breaks the line, so an unreported day is a visible gap. */
function Lines({ span, colorIndex, rows, label, log }: LinesProps) {
  // A log axis cannot draw zero, so zeros become gaps and the range comes from the positive values.
  const data = log ? logRows(rows) : rows
  const domain = log ? logDomain(data) : null
  const names = span.series.map((s) => s.name).join(', ')
  return (
    <div className="hub-chart" role="img" aria-label={`${label} for ${names}, ${span.start} to ${span.end}`}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={shortDate} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={compact}
            scale={domain ? 'log' : 'auto'}
            domain={domain ?? [0, 'auto']}
            allowDataOverflow={domain !== null}
          />
          <Tooltip
            {...tooltipProps}
            labelFormatter={shortDate}
            formatter={(value, name) => [typeof value === 'number' ? full(value) : 'not reported', name]}
          />
          {span.series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              name={s.name}
              dataKey={s.key}
              stroke={seriesColor(colorIndex[i])}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Three charts, each a section with one line on what it shows: daily downloads, their 7-day average, and each package's share. */
export default function DownloadCharts({ span, packages, colorIndex }: DownloadChartsProps) {
  const total = packages.reduce((sum, p) => sum + p.total, 0)
  const [log, setLog] = useState(false)
  return (
    <div className="hub-charts">
      <label className="hub-scale">
        <input type="checkbox" checked={log} onChange={(event) => setLog(event.target.checked)} />
        <span>
          <strong>Log scale</strong>
          <span className="ds-help">
            Spaces the vertical axis by ratio, so a small package is not flattened beside a large one. Applies to both line charts.
          </span>
        </span>
      </label>
      <section className="ds-section" aria-labelledby="daily-title">
        <div className="ds-section__head">
          <h2 id="daily-title" className="ds-section__title">
            Daily downloads
          </h2>
          <p className="ds-section__sub">
            Downloads per day, one line per package. Weekends dip because fewer builds run. A broken line is a day npm
            did not report.
          </p>
        </div>
        <Legend span={span} colorIndex={colorIndex} />
        <Lines span={span} colorIndex={colorIndex} rows={dailyRows(span)} label="Daily downloads" log={log} />
      </section>

      <section className="ds-section" aria-labelledby="average-title">
        <div className="ds-section__head">
          <h2 id="average-title" className="ds-section__title">
            {AVERAGE_SPAN}-day moving average
          </h2>
          <p className="ds-section__sub">
            Each point averages the last {AVERAGE_SPAN} days, which removes the weekly cycle so the real direction of each
            package shows. It starts on day {AVERAGE_SPAN}.
          </p>
        </div>
        <Legend span={span} colorIndex={colorIndex} />
        <Lines span={span} colorIndex={colorIndex} rows={averageRows(span)} label="7-day moving average of downloads" log={log} />
      </section>

      <section className="ds-section" aria-labelledby="share-title">
        <div className="ds-section__head">
          <h2 id="share-title" className="ds-section__title">
            Share of downloads
          </h2>
          <p className="ds-section__sub">Each package's part of the selection's downloads over the window.</p>
        </div>
        {packages.length < 2 ? (
          <p className="ds-empty">Share compares packages. Add a second package to see it.</p>
        ) : (
          <div className="hub-share-chart">
            <div className="hub-donut" role="img" aria-label={`Share of downloads: ${packages.map((p) => `${p.name} ${p.sharePct}%`).join(', ')}`}>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={packages} dataKey="total" nameKey="name" innerRadius="58%" outerRadius="92%" paddingAngle={1} stroke="none" isAnimationActive={false}>
                    {packages.map((p, i) => (
                      <Cell key={p.name} fill={seriesColor(colorIndex[i])} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipProps} formatter={(value, name) => [full(Number(value)), name]} />
                </PieChart>
              </ResponsiveContainer>
              <p className="hub-donut__center ds-num">
                <span>{compact(total)}</span>
                <span className="ds-help">downloads</span>
              </p>
            </div>
            <ul className="hub-share-list">
              {[...packages.keys()]
                .sort((a, b) => packages[b].total - packages[a].total)
                .map((i) => (
                  <li key={packages[i].name}>
                    <span className="hub-swatch" style={{ background: seriesColor(colorIndex[i]) }} aria-hidden="true" />
                    <span className="ds-mono hub-share-list__name">{packages[i].name}</span>
                    <span className="ds-num">{packages[i].sharePct}%</span>
                    <span className="ds-num ds-help">{compact(packages[i].total)}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
