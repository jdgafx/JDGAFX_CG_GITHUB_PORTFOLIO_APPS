import { COMPARISON_DAYS, mockSummaryStats } from '../lib/mockData'
import { useInsightRun } from '../lib/insightRun'
import AppShell from './AppShell'
import InsightControls from './InsightControls'
import InsightsPanel from './InsightsPanel'
import MetricCard from './MetricCard'
import UsageCharts from './UsageCharts'

interface DashboardProps {
  onLogout: () => void
  isDemoMode: boolean
  userEmail?: string
}

export default function Dashboard({ onLogout, isDemoMode, userEmail }: DashboardProps) {
  const stats = mockSummaryStats
  const run = useInsightRun(stats)

  return (
    <AppShell
      purpose="A SaaS analytics dashboard, with an AI analysis of its summary figures."
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
          <div className="hub-action">
            <button type="button" className="ds-button" onClick={onLogout}>
              {isDemoMode ? 'Exit demo' : 'Sign out'}
            </button>
            <p className="ds-help">
              {isDemoMode ? 'Returns to the sign-in screen.' : 'Ends this session and returns to the sign-in screen.'}
            </p>
          </div>
        </>
      }
    >
      <div className="ds-bench hub-bench">
        <InsightControls run={run} />

        <section className="ds-section hub-figures" aria-labelledby="figures-title">
          <div className="ds-section__head">
            <h2 id="figures-title" className="ds-section__title">
              Summary figures
            </h2>
            <p className="ds-section__sub">
              Seeded demo dataset: the last {COMPARISON_DAYS} days against the {COMPARISON_DAYS} before. The AI analysis
              reads these five figures.
            </p>
          </div>
          <dl className="ds-strip hub-figure-strip">
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
          </dl>
        </section>

        <InsightsPanel run={run} />
        <UsageCharts />
      </div>
    </AppShell>
  )
}
