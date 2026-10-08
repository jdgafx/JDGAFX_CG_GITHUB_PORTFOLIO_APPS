import { mockSummaryStats, COMPARISON_DAYS } from '../lib/mockData'
import AppShell from './AppShell'
import MetricCard from './MetricCard'
import InsightsPanel from './InsightsPanel'
import UsageCharts from './UsageCharts'

interface DashboardProps {
  onLogout: () => void
  isDemoMode: boolean
  userEmail?: string
}

export default function Dashboard({ onLogout, isDemoMode, userEmail }: DashboardProps) {
  const stats = mockSummaryStats

  return (
    <AppShell
      purpose="AI analysis of a SaaS usage snapshot"
      badge={
        isDemoMode ? (
          <span className="ds-badge ds-badge--warning">Demo data</span>
        ) : (
          <span className="ds-badge ds-badge--success">Signed in</span>
        )
      }
      actions={
        <>
          {userEmail && <span className="ds-hint hub-email">{userEmail}</span>}
          <button type="button" className="ds-button" onClick={onLogout}>
            {isDemoMode ? 'Exit demo' : 'Sign out'}
          </button>
        </>
      }
    >
      <section className="ds-card" aria-labelledby="snapshot-title">
        <div className="ds-card__head">
          <h2 id="snapshot-title" className="ds-card__title">Summary snapshot</h2>
          <span className="ds-hint">
            Seeded demo dataset, last {COMPARISON_DAYS} days vs prior {COMPARISON_DAYS}
          </span>
        </div>
        <div className="ds-metrics">
          <MetricCard
            label="API calls"
            value={stats.totalApiCalls.toLocaleString()}
            trend={stats.apiCallsTrend}
            higherIsBetter
          />
          <MetricCard
            label="Total tokens"
            value={`${(stats.totalTokens / 1_000_000).toFixed(1)}M`}
            trend={stats.tokensTrend}
            higherIsBetter
          />
          <MetricCard
            label="Avg response"
            value={`${stats.avgResponseTime} ms`}
            trend={stats.responseTimeTrend}
            higherIsBetter={false}
          />
          <MetricCard
            label="Error rate"
            value={`${stats.avgErrorRate}%`}
            trend={stats.errorRateTrend}
            higherIsBetter={false}
          />
          <MetricCard
            label="Total cost"
            value={`$${stats.totalCost.toFixed(2)}`}
            trend={stats.costTrend}
            higherIsBetter={false}
          />
        </div>
      </section>

      <InsightsPanel stats={stats} />

      <UsageCharts />
    </AppShell>
  )
}
