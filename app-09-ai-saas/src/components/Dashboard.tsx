import { motion } from 'framer-motion'
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
import {
  TrendingUp,
  Zap,
  Clock,
  DollarSign,
  LogOut,
  Activity,
  Cpu,
  AlertTriangle,
} from 'lucide-react'
import {
  mockDailyUsage,
  mockFeatureUsage,
  mockSummaryStats,
  WINDOW_DAYS,
  COMPARISON_DAYS,
} from '../lib/mockData'
import MetricCard from './MetricCard'
import InsightsPanel from './InsightsPanel'

interface DashboardProps {
  onLogout: () => void
  isDemoMode: boolean
  userEmail?: string
}

const COMPARISON_LABEL = `Last ${COMPARISON_DAYS} days vs prior ${COMPARISON_DAYS}`

const cardStyle: React.CSSProperties = {
  background: 'rgba(15, 15, 30, 0.8)',
  border: '1px solid rgba(99, 102, 241, 0.15)',
  borderRadius: '16px',
  padding: '24px',
}

const chartTooltipStyle: React.CSSProperties = {
  background: '#0f0f1e',
  border: '1px solid rgba(99,102,241,0.3)',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#e2e8f0',
}

const axisTick = { fontSize: 11, fill: '#475569' }

export default function Dashboard({ onLogout, isDemoMode, userEmail }: DashboardProps) {
  const stats = mockSummaryStats

  const chartData = mockDailyUsage.map((d) => ({
    date: d.date.slice(5),
    calls: d.api_calls,
    errorRate: d.error_rate,
  }))

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a12' }}>
      <header
        style={{
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(10, 10, 18, 0.95)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            maxWidth: '1400px',
            margin: '0 auto',
            padding: '0 24px',
            minHeight: '64px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <rect x="3" y="3" width="26" height="26" rx="4" stroke="#fff" strokeWidth="1.5" fill="rgba(255,255,255,0.1)"/>
                <line x1="3" y1="11" x2="29" y2="11" stroke="#fff" strokeWidth="1" opacity="0.3"/>
                <line x1="11" y1="11" x2="11" y2="29" stroke="#fff" strokeWidth="1" opacity="0.3"/>
                <rect x="14" y="15" width="5" height="3" rx="0.5" fill="#fff" opacity="0.5"/>
                <rect x="14" y="20" width="8" height="3" rx="0.5" fill="#fff" opacity="0.7"/>
                <rect x="14" y="25" width="3" height="2" rx="0.5" fill="#c4b5fd"/>
                <path d="M5 5h4M5 7h2" stroke="#c4b5fd" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
              </svg>
            </div>
            <span style={{ fontSize: '18px', fontWeight: 700, color: '#f1f5f9', flexShrink: 0 }}>InsightHub</span>
            {isDemoMode && (
              <span
                title="You are viewing the seeded demo dataset — no account is signed in"
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: '20px',
                  background: 'rgba(251, 191, 36, 0.12)',
                  color: '#fbbf24',
                  border: '1px solid rgba(251,191,36,0.2)',
                  letterSpacing: '0.5px',
                  flexShrink: 0,
                }}
              >
                DEMO
              </span>
            )}
          </div>

          <div className="flex items-center gap-4">
            {userEmail && (
              <span title="Signed in account" style={{ fontSize: '13px', color: '#64748b' }}>
                {userEmail}
              </span>
            )}
            <button
              onClick={onLogout}
              title={
                isDemoMode
                  ? 'Leave the demo and return to the sign-in screen'
                  : 'Sign out of your account'
              }
              className="flex items-center gap-2"
              style={{
                padding: '8px 14px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '8px',
                color: '#94a3b8',
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
              }}
            >
              <LogOut size={14} />
              {isDemoMode ? 'Exit Demo' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      <div style={{ borderBottom: '1px solid rgba(99,102,241,0.08)', background: 'rgba(99,102,241,0.02)' }}>
        <p style={{ maxWidth: '1400px', margin: '0 auto', padding: '8px 24px', fontSize: '11px', color: '#475569', lineHeight: '1.5' }}>
          A SaaS analytics dashboard with real auth (via Supabase) and AI-generated business
          insights. Charts render a simulated dataset — API calls, feature usage, error rates and
          latency across {WINDOW_DAYS} days. The AI reads those numbers and tells you what's
          actually happening.
        </p>
      </div>

      <main style={{ maxWidth: '1400px', margin: '0 auto', padding: '32px 24px' }}>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          style={{ marginBottom: '24px' }}
        >
          <h2 style={{ fontSize: '26px', fontWeight: 700, color: '#f1f5f9', marginBottom: '6px' }}>
            API Analytics
          </h2>
          <p style={{ fontSize: '14px', color: '#64748b' }}>
            Simulated dataset (seeded demo data) · {WINDOW_DAYS}-day window
          </p>
        </motion.div>

        <p
          title="Each card totals or averages the most recent half of the window and compares it against the half before it"
          style={{ fontSize: '12px', color: '#475569', marginBottom: '12px', letterSpacing: '0.3px' }}
        >
          {COMPARISON_LABEL}
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
            gap: '16px',
            marginBottom: '28px',
          }}
        >
          <MetricCard
            label="API Calls"
            value={stats.totalApiCalls.toLocaleString()}
            trend={stats.apiCallsTrend}
            higherIsBetter
            icon={<Activity size={18} />}
            hint={`Total requests served over the last ${COMPARISON_DAYS} days. More calls means more adoption.`}
            delay={0}
          />
          <MetricCard
            label="Total Tokens"
            value={`${(stats.totalTokens / 1_000_000).toFixed(1)}M`}
            trend={stats.tokensTrend}
            higherIsBetter
            icon={<Cpu size={18} />}
            hint={`Tokens processed over the last ${COMPARISON_DAYS} days across all features.`}
            delay={0.05}
          />
          <MetricCard
            label="Avg Response"
            value={`${stats.avgResponseTime}ms`}
            trend={stats.responseTimeTrend}
            higherIsBetter={false}
            icon={<Clock size={18} />}
            hint="Mean end-to-end latency per request. Lower is better, so a falling number is shown as good."
            delay={0.1}
          />
          <MetricCard
            label="Error Rate"
            value={`${stats.avgErrorRate}%`}
            trend={stats.errorRateTrend}
            higherIsBetter={false}
            icon={<AlertTriangle size={18} />}
            hint="Share of requests that returned an error. Lower is better."
            delay={0.15}
          />
          <MetricCard
            label="Total Cost"
            value={`$${stats.totalCost.toFixed(2)}`}
            trend={stats.costTrend}
            higherIsBetter={false}
            icon={<DollarSign size={18} />}
            hint={`Inference spend over the last ${COMPARISON_DAYS} days. Lower is better, so rising spend is flagged.`}
            delay={0.2}
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(400px, 100%), 1fr))',
            gap: '20px',
            marginBottom: '24px',
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            style={cardStyle}
          >
            <div className="flex items-center gap-2 mb-6">
              <TrendingUp size={16} style={{ color: '#6366f1' }} aria-hidden="true" />
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>
                Daily API Calls
              </h3>
              <span
                title={`Requests served per day across the full ${WINDOW_DAYS}-day window`}
                style={{ marginLeft: 'auto', fontSize: '12px', color: '#475569' }}
              >
                {WINDOW_DAYS} days
              </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={45} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [v.toLocaleString(), 'Calls']} />
                <Line
                  type="monotone"
                  dataKey="calls"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#6366f1' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.25 }}
            style={cardStyle}
          >
            <div className="flex items-center gap-2 mb-6">
              <Zap size={16} style={{ color: '#8b5cf6' }} aria-hidden="true" />
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>
                Feature Usage
              </h3>
              <span
                title="Calls broken down by product feature over the same window"
                style={{ marginLeft: 'auto', fontSize: '12px', color: '#475569' }}
              >
                {mockFeatureUsage.length} features
              </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={mockFeatureUsage} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="feature"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [v.toLocaleString(), 'Calls']} />
                <Bar dataKey="calls" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
            style={cardStyle}
          >
            <div className="flex items-center gap-2 mb-6">
              <AlertTriangle size={16} style={{ color: '#f59e0b' }} aria-hidden="true" />
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>
                Error Rate
              </h3>
              <span
                title="Percentage of requests that failed each day — trending down is healthy"
                style={{ marginLeft: 'auto', fontSize: '12px', color: '#475569' }}
              >
                % of requests
              </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={false} interval={4} />
                <YAxis
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={45}
                  domain={[0, 'auto']}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [`${v}%`, 'Error rate']} />
                <Line
                  type="monotone"
                  dataKey="errorRate"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#f59e0b' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </motion.div>
        </div>

        <InsightsPanel stats={stats} />
      </main>

      <footer style={{ textAlign: 'center', padding: '12px 0', fontSize: 11, color: '#475569', borderTop: '1px solid rgba(99,102,241,0.1)' }}>
        Authored by Christopher Gentile / CGDarkstardev1 / NewDawn AI
      </footer>
    </div>
  )
}
