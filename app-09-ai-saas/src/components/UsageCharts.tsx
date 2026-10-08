import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { CHART_KEYS, CHART_MOTION, toDailyPoints, toFeaturePoints } from '../lib/chartData'
import { mockDailyUsage, mockFeatureUsage, WINDOW_DAYS } from '../lib/mockData'

// Literal fallbacks for the series colours. app.css reads the shared tokens; these apply only if it does not load.
const SIGNAL = '#0e7c86'
const GRAPHITE = '#56637a'

const dailyPoints = toDailyPoints(mockDailyUsage)
const featurePoints = toFeaturePoints(mockFeatureUsage)
const firstDay = dailyPoints[0]
const lastDay = dailyPoints[dailyPoints.length - 1]
const topFeature = featurePoints.reduce((top, f) => (f.calls > top.calls ? f : top))
// 28px per feature row plus the axis, so every category label stays visible.
const featureChartHeight = Math.max(220, featurePoints.length * 28 + 40)

// Colours come from the tokens, with fallbacks, so the charts follow light and dark mode.
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

/** Three charts, each a section with one line on what it shows. Every chart has a fixed height in app.css. */
export default function UsageCharts() {
  return (
    <div className="hub-charts">
      <section className="ds-section" aria-labelledby="calls-title">
        <div className="ds-section__head">
          <h2 id="calls-title" className="ds-section__title">
            Daily API calls
          </h2>
          <p className="ds-section__sub">API calls per day over {WINDOW_DAYS} days. Every fifth date is labelled.</p>
        </div>
        <div
          className="hub-chart"
          role="img"
          aria-label={`Daily API calls from ${firstDay.calls} on ${firstDay.date} to ${lastDay.calls} on ${lastDay.date}`}
        >
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dailyPoints}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={CHART_KEYS.date} tickLine={false} axisLine={false} interval={4} />
              <YAxis tickLine={false} axisLine={false} width={45} />
              <Tooltip {...tooltipProps} formatter={(v: number) => [v.toLocaleString(), 'Calls']} />
              <Line
                type="monotone"
                dataKey={CHART_KEYS.calls}
                stroke={SIGNAL}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                {...CHART_MOTION}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="ds-section" aria-labelledby="feature-title">
        <div className="ds-section__head">
          <h2 id="feature-title" className="ds-section__title">
            Feature usage
          </h2>
          <p className="ds-section__sub">Calls by feature over the same {WINDOW_DAYS} days. Hover a bar for its count.</p>
        </div>
        <div
          className="hub-chart"
          role="img"
          aria-label={`Calls by feature over ${WINDOW_DAYS} days; ${topFeature.feature} is the largest with ${topFeature.calls.toLocaleString()}`}
        >
          <ResponsiveContainer width="100%" height={featureChartHeight}>
            <BarChart data={featurePoints} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey={CHART_KEYS.feature} tickLine={false} axisLine={false} width={80} interval={0} />
              <Tooltip {...tooltipProps} formatter={(v: number) => [v.toLocaleString(), 'Calls']} />
              <Bar dataKey={CHART_KEYS.calls} fill={SIGNAL} radius={[0, 4, 4, 0]} {...CHART_MOTION} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="ds-section" aria-labelledby="errors-title">
        <div className="ds-section__head">
          <h2 id="errors-title" className="ds-section__title">
            Error rate
          </h2>
          <p className="ds-section__sub">Share of requests that failed each day, as a percentage.</p>
        </div>
        <div
          className="hub-chart hub-chart--muted"
          role="img"
          aria-label={`Daily error rate from ${firstDay.errorRate}% on ${firstDay.date} to ${lastDay.errorRate}% on ${lastDay.date}`}
        >
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dailyPoints}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={CHART_KEYS.date} tickLine={false} axisLine={false} interval={4} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={45}
                domain={[0, 'auto']}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip {...tooltipProps} formatter={(v: number) => [`${v}%`, 'Error rate']} />
              <Line
                type="monotone"
                dataKey={CHART_KEYS.errorRate}
                stroke={GRAPHITE}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                {...CHART_MOTION}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}
