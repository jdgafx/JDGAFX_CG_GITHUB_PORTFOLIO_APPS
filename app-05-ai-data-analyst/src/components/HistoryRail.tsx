import { motion, AnimatePresence } from 'framer-motion'
import { Clock, ChevronDown, ChevronUp } from 'lucide-react'
import type { HistoryEntry } from '../types'

interface HistoryRailProps {
  history: HistoryEntry[]
  isOpen: boolean
  onToggle: () => void
  onSelect: (entry: HistoryEntry) => void
}

export default function HistoryRail({ history, isOpen, onToggle, onSelect }: HistoryRailProps) {
  return (
    <aside className="dp-rail" aria-label="Query history">
      <button
        type="button"
        onClick={onToggle}
        title={isOpen ? 'Hide the query history' : 'Show the query history'}
        aria-expanded={isOpen}
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          borderBottomStyle: 'solid',
          width: '100%',
          cursor: 'pointer',
          fontFamily: 'DM Sans, sans-serif',
        }}
      >
        <Clock size={13} color="#4a4a6a" aria-hidden="true" />
        <span
          style={{
            fontSize: '11px',
            color: '#4a4a6a',
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          Query History
        </span>
        {history.length > 0 && (
          <span
            style={{
              fontSize: '10px',
              color: '#4a4a6a',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '3px',
              padding: '1px 5px',
            }}
          >
            {history.length}
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: '#4a4a6a' }} aria-hidden="true">
          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {!isOpen ? null : history.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            color: '#4a4a6a',
            fontSize: '12px',
            padding: '24px 20px',
            textAlign: 'center',
          }}
        >
          <Clock size={24} color="rgba(255,51,102,0.15)" aria-hidden="true" />
          <span>Your analyzed queries will appear here</span>
        </div>
      ) : (
        <div className="dp-rail-list">
          <AnimatePresence initial={false}>
            {history.map((entry) => (
              <motion.button
                key={entry.id}
                type="button"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25 }}
                onClick={() => onSelect(entry)}
                title={`Reopen this ${entry.result.queryPlan.chartType} chart from ${entry.dataset}`}
                style={{
                  width: '100%',
                  display: 'block',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.04)',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  marginBottom: '6px',
                  fontFamily: 'DM Sans, sans-serif',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLButtonElement
                  el.style.background = 'rgba(255,51,102,0.07)'
                  el.style.borderColor = 'rgba(255,51,102,0.18)'
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLButtonElement
                  el.style.background = 'rgba(255,255,255,0.02)'
                  el.style.borderColor = 'rgba(255,255,255,0.04)'
                }}
              >
                <div
                  style={{
                    fontSize: '11px',
                    color: '#4a4a6a',
                    marginBottom: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span
                    style={{
                      color: '#ff3366',
                      background: 'rgba(255,51,102,0.1)',
                      borderRadius: '3px',
                      padding: '1px 5px',
                      fontSize: '10px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                    }}
                  >
                    {entry.result.queryPlan.chartType}
                  </span>
                  <span>
                    {entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p
                  style={{
                    margin: '0 0 4px',
                    fontSize: '12px',
                    color: '#f0f0fa',
                    lineHeight: '1.4',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {entry.question}
                </p>
                <p style={{ margin: 0, fontSize: '11px', color: '#4a4a6a' }}>
                  {entry.dataset} · {entry.result.labels.length} groups
                </p>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
    </aside>
  )
}
