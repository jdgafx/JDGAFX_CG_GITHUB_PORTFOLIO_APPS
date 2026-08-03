import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, Square } from 'lucide-react'
import type { SummaryStats } from '../lib/mockData'
import { getInsights, abortInsights, isAbortError } from '../lib/api'

interface InsightsPanelProps {
  stats: SummaryStats
}

export default function InsightsPanel({ stats }: InsightsPanelProps) {
  const [insights, setInsights] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [insightError, setInsightError] = useState('')
  const [stopped, setStopped] = useState(false)

  // Leaving the dashboard (Exit Demo, sign out, navigation) must not leave a
  // stream running against the function.
  useEffect(() => abortInsights, [])

  const handleGenerate = async () => {
    setInsights('')
    setInsightError('')
    setStopped(false)
    setStreaming(true)

    try {
      await getInsights(stats, (chunk) => {
        setInsights((prev) => prev + chunk)
      })
    } catch (err) {
      if (isAbortError(err)) {
        setStopped(true)
      } else {
        setInsightError(err instanceof Error ? err.message : 'Failed to generate insights')
      }
    } finally {
      setStreaming(false)
    }
  }

  const handleStop = () => {
    abortInsights()
    setStopped(true)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.35 }}
      style={{
        background: 'rgba(15, 15, 30, 0.8)',
        border: '1px solid rgba(99, 102, 241, 0.15)',
        borderRadius: '16px',
        padding: '24px',
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-6" style={{ flexWrap: 'wrap' }}>
        <div className="flex items-center gap-2">
          <Sparkles size={16} style={{ color: '#6366f1' }} aria-hidden="true" />
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>
            AI-Generated Insights
          </h3>
          {streaming && (
            <span
              title="Claude is streaming its analysis of the metrics above"
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

        <div className="flex items-center gap-2">
          {streaming && (
            <button
              onClick={handleStop}
              title="Stop the stream and keep the text generated so far"
              className="flex items-center gap-2"
              style={{
                padding: '9px 14px',
                background: 'rgba(248,113,113,0.1)',
                border: '1px solid rgba(248,113,113,0.3)',
                borderRadius: '8px',
                color: '#f87171',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <Square size={12} />
              Stop
            </button>
          )}
          <button
            onClick={handleGenerate}
            disabled={streaming}
            title={
              streaming
                ? 'Generation already in progress'
                : 'Send the summary metrics to Claude and stream back an analysis'
            }
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
            {streaming ? 'Generating...' : insights ? 'Regenerate' : 'Generate Insights'}
          </button>
        </div>
      </div>

      {insightError && (
        <div
          role="alert"
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
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#475569' }}>
          <Sparkles size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} aria-hidden="true" />
          <p style={{ fontSize: '14px' }}>
            Click "Generate Insights" to get Claude's analysis of your metrics
          </p>
        </div>
      )}

      {(insights || streaming) && (
        <div
          aria-live="polite"
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

      {stopped && !streaming && (
        <p role="status" style={{ marginTop: '12px', fontSize: '12px', color: '#64748b' }}>
          Generation stopped. Click Generate Insights to start again.
        </p>
      )}
    </motion.div>
  )
}
