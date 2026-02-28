import { useState } from 'react'
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
  TrendingDown,
  Zap,
  Clock,
  DollarSign,
  LogOut,
  Sparkles,
  Activity,
  Cpu,
} from 'lucide-react'
import { mockDailyUsage, mockFeatureUsage, mockSummaryStats } from '../lib/mockData'
import { getInsights } from '../lib/api'

interface DashboardProps {
  onLogout: () => void
  isDemoMode: boolean
  userEmail?: string
}

interface MetricCardProps {
  label: string
  value: string
  trend: number
  icon: React.ReactNode
  delay: number
}

function MetricCard({ label, value, trend, icon, delay }: MetricCardProps) {
  const isPositive = trend >= 0
  const trendLabel = `${isPositive ? '+' : ''}${trend}%`

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      style={{
        background: 'rgba(15, 15, 30, 0.8)',
        border: '1px solid rgba(99, 102, 241, 0.15)',
        borderRadius: '16px',
        padding: '24px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '120px',
          height: '120px',
          background: 'radial-gradient(circle at top right, rgba(99,102,241,0.08), transparent 70%)',
        }}
      />
      <div className="flex items-start justify-between mb-4">
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: 'rgba(99, 102, 241, 0.12)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#818cf8',
          }}
        >
          {icon}
        </div>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 500,
            padding: '4px 8px',
            borderRadius: '6px',
            background: isPositive ? 'rgba(52, 211, 153, 0.08)' : 'rgba(248, 113, 113, 0.08)',
            color: isPositive ? '#34d399' : '#f87171',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
          }}
        >
          {isPositive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {trendLabel}
        </span>
      </div>
      <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '6px' }}>{label}</p>
      <p style={{ fontSize: '28px', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.5px' }}>
        {value}
      </p>
    </motion.div>
  )
}

export default function Dashboard({ onLogout, isDemoMode, userEmail }: DashboardProps) {
  const [insights, setInsights] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [insightError, setInsightError] = useState('')

  const chartData = mockDailyUsage.map((d) => ({
    date: d.date.slice(5),
    calls: d.api_calls,
    tokens: Math.round(d.tokens / 1000),
  }))

  const handleGenerateInsights = async () => {
    setInsights('')
    setInsightError('')
    setStreaming(true)

    try {
      await getInsights(mockSummaryStats, (chunk) => {
        setInsights((prev) => prev + chunk)
      })
    } catch (err) {
      setInsightError(err instanceof Error ? err.message : 'Failed to generate insights')
    } finally {
      setStreaming(false)
    }
  }

  const stats = mockSummaryStats

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
            height: '64px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
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
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
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
              <span style={{ fontSize: '13px', color: '#64748b' }}>{userEmail}</span>
            )}
            <button
              onClick={onLogout}
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
          A mock SaaS analytics dashboard with real auth (via Supabase) and AI-generated business insights. Tracks API calls, feature usage, error rates, and latency over 30 days with interactive charts. The AI reads the numbers and tells you what's actually happening.
        </p>
      </div>

      <main style={{ maxWidth: '1400px', margin: '0 auto', padding: '32px 24px' }}>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          style={{ marginBottom: '32px' }}
        >
          <h2 style={{ fontSize: '26px', fontWeight: 700, color: '#f1f5f9', marginBottom: '6px' }}>
            API Analytics
          </h2>
          <p style={{ fontSize: '14px', color: '#64748b' }}>
            Last 30 days · All metrics based on real usage patterns
          </p>
        </motion.div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            marginBottom: '28px',
          }}
        >
          <MetricCard
            label="API Calls"
            value={stats.totalApiCalls.toLocaleString()}
            trend={stats.apiCallsTrend}
            icon={<Activity size={18} />}
            delay={0}
          />
          <MetricCard
            label="Total Tokens"
            value={`${(stats.totalTokens / 1_000_000).toFixed(1)}M`}
            trend={stats.tokensTrend}
            icon={<Cpu size={18} />}
            delay={0.05}
          />
          <MetricCard
            label="Avg Response"
            value={`${stats.avgResponseTime}ms`}
            trend={-stats.responseTimeTrend}
            icon={<Clock size={18} />}
            delay={0.1}
          />
          <MetricCard
            label="Total Cost"
            value={`$${stats.totalCost.toFixed(2)}`}
            trend={stats.costTrend}
            icon={<DollarSign size={18} />}
            delay={0.15}
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
            gap: '20px',
            marginBottom: '24px',
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            style={{
              background: 'rgba(15, 15, 30, 0.8)',
              border: '1px solid rgba(99, 102, 241, 0.15)',
              borderRadius: '16px',
              padding: '24px',
            }}
          >
            <div className="flex items-center gap-2 mb-6">
              <TrendingUp size={16} style={{ color: '#6366f1' }} />
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>
                Daily API Calls
              </h3>
              <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#475569' }}>
                30 days
              </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickLine={false}
                  axisLine={false}
                  interval={4}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickLine={false}
                  axisLine={false}
                  width={45}
                />
                <Tooltip
                  contentStyle={{
                    background: '#0f0f1e',
                    border: '1px solid rgba(99,102,241,0.3)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#e2e8f0',
                  }}
                />
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
            style={{
              background: 'rgba(15, 15, 30, 0.8)',
              border: '1px solid rgba(99, 102, 241, 0.15)',
              borderRadius: '16px',
              padding: '24px',
            }}
          >
            <div className="flex items-center gap-2 mb-6">
              <Zap size={16} style={{ color: '#8b5cf6' }} />
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>
                Feature Usage
              </h3>
              <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#475569' }}>
                8 features
              </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={mockFeatureUsage} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="feature"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                />
                <Tooltip
                  contentStyle={{
                    background: '#0f0f1e',
                    border: '1px solid rgba(99,102,241,0.3)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#e2e8f0',
                  }}
                />
                <Bar dataKey="calls" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          style={{
            background: 'rgba(15, 15, 30, 0.8)',
            border: '1px solid rgba(99, 102, 241, 0.15)',
            borderRadius: '16px',
            padding: '24px',
          }}
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Sparkles size={16} style={{ color: '#6366f1' }} />
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>
                AI-Generated Insights
              </h3>
              {streaming && (
                <span
                  style={{
                    fontSize: '11px',
                    color: '#818cf8',
                    padding: '2px 8px',
                    background: 'rgba(99,102,241,0.1)',
                    borderRadius: '10px',
                    animation: 'pulse 1.5s infinite',
                  }}
                >
                  Streaming...
                </span>
              )}
            </div>
            <button
              onClick={handleGenerateInsights}
              disabled={streaming}
              className="flex items-center gap-2"
              style={{
                padding: '9px 16px',
                background: streaming
                  ? 'rgba(99,102,241,0.3)'
                  : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                border: 'none',
                borderRadius: '8px',
                color: 'white',
                fontSize: '13px',
                fontWeight: 500,
                cursor: streaming ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <Sparkles size={14} />
              {streaming ? 'Generating...' : 'Generate Insights'}
            </button>
          </div>

          {insightError && (
            <div
              style={{
                padding: '12px 16px',
                background: 'rgba(248,113,113,0.08)',
                border: '1px solid rgba(248,113,113,0.2)',
                borderRadius: '10px',
                color: '#f87171',
                fontSize: '14px',
              }}
            >
              {insightError}
            </div>
          )}

          {!insights && !streaming && !insightError && (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: '#475569',
              }}
            >
              <Sparkles size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
              <p style={{ fontSize: '14px' }}>
                Click "Generate Insights" to get Claude's analysis of your metrics
              </p>
            </div>
          )}

          {(insights || streaming) && (
            <div
              style={{
                padding: '20px',
                background: 'rgba(99,102,241,0.04)',
                border: '1px solid rgba(99,102,241,0.1)',
                borderRadius: '12px',
                fontSize: '14px',
                lineHeight: '1.8',
                color: '#cbd5e1',
                fontFamily: 'var(--font-sans)',
                whiteSpace: 'pre-wrap',
                minHeight: '120px',
              }}
            >
              {insights}
              {streaming && (
                <span
                  style={{
                    display: 'inline-block',
                    width: '2px',
                    height: '16px',
                    background: '#6366f1',
                    marginLeft: '2px',
                    verticalAlign: 'middle',
                    animation: 'pulse 1s infinite',
                  }}
                />
              )}
            </div>
          )}
        </motion.div>
      </main>
      <footer style={{ textAlign: 'center', padding: '12px 0', fontSize: 11, color: '#475569', borderTop: '1px solid rgba(99,102,241,0.1)' }}>
        Authored by Christopher Gentile / CGDarkstardev1 / NewDawn AI
      </footer>
    </div>
  )
}
