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
import { mockDailyUsage, mockFeatureUsage, WINDOW_DAYS } from '../lib/mockData'

const chartData = mockDailyUsage.map((d) => ({
  date: d.date.slice(5),
  calls: d.api_calls,
  errorRate: d.error_rate,
}))

const firstDay = chartData[0]
const lastDay = chartData[chartData.length - 1]
const topFeature = mockFeatureUsage.reduce((top, f) => (f.calls > top.calls ? f : top))

// Colours come from the tokens through hub-chart classes in app.css, so the charts follow light and dark mode.
const tooltipProps = {
  contentStyle: {
    background: 'var(--ds-surface)',
    border: '1px solid var(--ds-border)',
    borderRadius: 'var(--ds-radius-sm)',
    boxShadow: 'var(--ds-shadow)',
    fontSize: 12,
  },
  labelStyle: { color: 'var(--ds-text-muted)' },
  itemStyle: { color: 'var(--ds-text)' },
}

export default function UsageCharts() {
  return (
    <div className="ds-grid-2">
      <section className="ds-card" aria-labelledby="calls-title">
        <div className="ds-card__head">
          <h2 id="calls-title" className="ds-card__title">Daily API calls</h2>
          <span className="ds-hint">{WINDOW_DAYS} days</span>
        </div>
        <div
          className="hub-chart"
          role="img"
          aria-label={`Daily API calls from ${firstDay.calls} on ${firstDay.date} to ${lastDay.calls} on ${lastDay.date}`}
        >
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} interval={4} />
              <YAxis tickLine={false} axisLine={false} width={45} />
              <Tooltip {...tooltipProps} formatter={(v: number) => [v.toLocaleString(), 'Calls']} />
              <Line type="monotone" dataKey="calls" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="ds-card" aria-labelledby="feature-title">
        <div className="ds-card__head">
          <h2 id="feature-title" className="ds-card__title">Feature usage</h2>
          <span className="ds-hint">{mockFeatureUsage.length} features</span>
        </div>
        <div
          className="hub-chart"
          role="img"
          aria-label={`Calls by feature over ${WINDOW_DAYS} days; ${topFeature.feature} is the largest with ${topFeature.calls.toLocaleString()}`}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={mockFeatureUsage} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="feature" tickLine={false} axisLine={false} width={80} />
              <Tooltip {...tooltipProps} formatter={(v: number) => [v.toLocaleString(), 'Calls']} />
              <Bar dataKey="calls" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="ds-card" aria-labelledby="errors-title">
        <div className="ds-card__head">
          <h2 id="errors-title" className="ds-card__title">Error rate</h2>
          <span className="ds-hint">% of requests</span>
        </div>
        <div
          className="hub-chart hub-chart--warn"
          role="img"
          aria-label={`Daily error rate from ${firstDay.errorRate}% on ${firstDay.date} to ${lastDay.errorRate}% on ${lastDay.date}`}
        >
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} interval={4} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={45}
                domain={[0, 'auto']}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip {...tooltipProps} formatter={(v: number) => [`${v}%`, 'Error rate']} />
              <Line type="monotone" dataKey="errorRate" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}
