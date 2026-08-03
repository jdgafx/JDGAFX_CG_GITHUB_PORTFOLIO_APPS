import { SEVERITIES, SEVERITY_CONFIG, SEVERITY_HINT } from '../constants'
import type { Severity } from '../types'

interface HeaderProps {
  counts: Record<Severity, number>
  filters: Record<Severity, boolean>
  hasResults: boolean
  onToggleFilter: (severity: Severity) => void
}

export function Header({ counts, filters, hasResults, onToggleFilter }: HeaderProps) {
  return (
    <header
      style={{
        padding: '16px 24px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(10,14,26,0.9)',
        backdropFilter: 'blur(12px)',
        zIndex: 10,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap' as const,
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '9px',
              background: 'linear-gradient(135deg, #ffa500, #ff6b00)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 20px rgba(255,165,0,0.3)',
              flexShrink: 0,
            }}
          >
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path d="M11 7L4 16L11 25" stroke="#ffa500" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M21 7L28 16L21 25" stroke="#ff6b00" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="3" y1="16" x2="29" y2="16" stroke="#ffd700" strokeWidth="1.5" opacity="0.5"/>
              <circle cx="16" cy="16" r="3" fill="#ffa500" opacity="0.3"/>
              <circle cx="16" cy="16" r="1.5" fill="#ffa500"/>
            </svg>
          </div>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: 700,
                color: '#f1f5f9',
                letterSpacing: '-0.02em',
                lineHeight: 1.2,
              }}
            >
              CodeLens<span style={{ color: '#ffa500' }}> AI</span>
            </h1>
            <p style={{ margin: 0, fontSize: '12px', color: '#4b5563', lineHeight: 1.3 }}>
              AI-Powered Code Review Agent
            </p>
          </div>
        </div>

        <div
          role="group"
          aria-label="Filter review comments by severity"
          style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' as const }}
        >
          {SEVERITIES.map((sev) => {
            const conf = SEVERITY_CONFIG[sev]
            const Icon = conf.icon
            const on = filters[sev]
            return (
              <button
                key={sev}
                type="button"
                aria-pressed={on}
                disabled={!hasResults}
                onClick={() => onToggleFilter(sev)}
                title={
                  hasResults
                    ? `${on ? 'Hide' : 'Show'} ${conf.label.toLowerCase()} comments — ${SEVERITY_HINT[sev]}`
                    : `${conf.label}: ${SEVERITY_HINT[sev]}. Run a review to filter by it.`
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: 500,
                  fontFamily: "'Source Sans 3', sans-serif",
                  backgroundColor: on ? 'rgba(255,255,255,0.03)' : 'transparent',
                  color: conf.color,
                  border: `1px solid ${conf.color}${on ? '55' : '22'}`,
                  opacity: hasResults && !on ? 0.45 : 1,
                  cursor: hasResults ? 'pointer' : 'default',
                  textDecoration: hasResults && !on ? 'line-through' : 'none',
                  transition: 'opacity 0.2s ease, border-color 0.2s ease',
                }}
              >
                <Icon size={11} />
                {conf.label}
                {hasResults ? ` ${counts[sev]}` : ''}
              </button>
            )
          })}
        </div>
      </div>
    </header>
  )
}
