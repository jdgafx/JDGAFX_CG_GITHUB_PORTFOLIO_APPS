import { motion } from 'framer-motion'
import { SEVERITY_CONFIG } from '../constants'
import type { ReviewComment } from '../types'

interface ReviewCardProps {
  comment: ReviewComment
  index: number
  onClick: () => void
  isActive: boolean
}

export function ReviewCard({ comment, index, onClick, isActive }: ReviewCardProps) {
  const config = SEVERITY_CONFIG[comment.severity]
  const Icon = config.icon

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      title={`${config.label} on line ${comment.line} — click to jump to it in the editor`}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ delay: index * 0.06, duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      style={{
        background: isActive ? config.bg : 'rgba(255,255,255,0.02)',
        border: `1px solid ${isActive ? config.borderColor + '55' : 'rgba(255,255,255,0.06)'}`,
        borderLeft: `4px solid ${config.color}`,
        borderRadius: '8px',
        padding: '14px 16px',
        cursor: 'pointer',
        marginBottom: '10px',
        transition: 'background 0.2s ease, border-color 0.2s ease',
      }}
      whileHover={{ backgroundColor: config.bg }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 8px',
            borderRadius: '999px',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase' as const,
            backgroundColor: config.bg,
            color: config.color,
            border: `1px solid ${config.color}44`,
          }}
        >
          <Icon size={10} />
          {config.label}
        </span>
        <span
          style={{
            fontSize: '12px',
            color: '#4b5563',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Line {comment.line}
        </span>
      </div>

      <p
        style={{
          margin: '0 0 8px 0',
          fontSize: '13.5px',
          color: '#e2e8f0',
          lineHeight: 1.55,
          fontWeight: 500,
        }}
      >
        {comment.message}
      </p>

      <div
        style={{
          fontSize: '12.5px',
          color: '#94a3b8',
          lineHeight: 1.55,
          borderTop: '1px solid rgba(255,255,255,0.05)',
          paddingTop: '8px',
        }}
      >
        <span style={{ color: '#ffa500', fontWeight: 600 }}>Suggestion: </span>
        {comment.suggestion}
      </div>
    </motion.div>
  )
}
