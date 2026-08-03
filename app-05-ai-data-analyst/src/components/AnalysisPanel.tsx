import { motion } from 'framer-motion'
import { Zap } from 'lucide-react'
import type { AnalysisResult } from '../types'

function format(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (!Number.isInteger(value)) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return value.toLocaleString()
}

/** A sum across groups only means something for additive aggregations. */
function summarize(result: AnalysisResult): string {
  const values = result.datasets[0]?.values ?? []
  const groups = `${result.labels.length} ${result.labels.length === 1 ? 'group' : 'groups'}`
  if (values.length === 0) return groups

  const fn = result.queryPlan.aggregate.fn
  const total = values.reduce((a, b) => a + b, 0)
  if (fn === 'sum') return `${groups} · ${format(total)} total`
  if (fn === 'count') return `${groups} · ${format(total)} rows counted`

  const min = Math.min(...values)
  const max = Math.max(...values)
  return `${groups} · ${fn} per group ranges ${format(min)} to ${format(max)}`
}

export default function AnalysisPanel({ result }: { result: AnalysisResult }) {
  const { queryPlan } = result

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      style={{
        background: 'rgba(14,14,28,0.6)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: '12px',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={13} color="#ff3366" aria-hidden="true" />
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#8a8aaa',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            Analysis
          </span>
        </div>
      </div>
      <div style={{ padding: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.6', color: '#8a8aaa' }}>
          {queryPlan.explanation}
        </p>
        <div
          title="The structured plan the AI produced, executed locally in your browser"
          style={{
            background: 'rgba(8,8,15,0.8)',
            border: '1px solid rgba(255,51,102,0.12)',
            borderRadius: '8px',
            padding: '14px 16px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '11px',
            color: '#4a4a6a',
            overflowX: 'auto',
            lineHeight: '1.7',
          }}
        >
          <div
            style={{
              color: '#ff3366',
              marginBottom: '6px',
              fontSize: '10px',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            Query Plan
          </div>
          <pre style={{ margin: 0, color: '#6a6a8a', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {JSON.stringify(
              {
                chartType: queryPlan.chartType,
                groupBy: queryPlan.groupBy,
                aggregate: queryPlan.aggregate,
                ...(queryPlan.filter ? { filter: queryPlan.filter } : {}),
                ...(queryPlan.sortBy ? { sortBy: queryPlan.sortBy } : {}),
              },
              null,
              2,
            )}
          </pre>
          <div style={{ color: '#4a4a6a', marginTop: '8px', fontSize: '10px' }}>
            {summarize(result)}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
