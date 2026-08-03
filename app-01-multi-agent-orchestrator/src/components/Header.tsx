import { formatTime } from '../lib/agents'

interface HeaderProps {
  elapsed: number
  isRunning: boolean
  isComplete: boolean
  totalTokens: number
}

export function Header({ elapsed, isRunning, isComplete, totalTokens }: HeaderProps) {
  return (
    <header
      style={{
        padding: '10px 24px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: '#111827',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ padding: 7, borderRadius: 10, background: 'rgba(0,212,255,0.12)', color: '#00d4ff', display: 'flex' }}>
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="5" fill="#00d4ff" />
              <circle cx="25" cy="7" r="5" fill="#00d4ff" opacity="0.6" />
              <circle cx="7" cy="25" r="5" fill="#00d4ff" opacity="0.4" />
              <circle cx="25" cy="25" r="5" fill="#00ff88" />
              <path d="M12 7L20 7M7 12L7 20M25 12L25 20M12 25L20 25" stroke="#00d4ff" strokeWidth="1.5" opacity="0.25" />
              <path d="M12 7L25 25" stroke="url(#af1)" strokeWidth="2.5" strokeLinecap="round" />
              <defs>
                <linearGradient id="af1" x1="12" y1="7" x2="25" y2="25">
                  <stop stopColor="#00d4ff" />
                  <stop offset="1" stopColor="#00ff88" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#f1f5f9', letterSpacing: -0.3 }}>AgentFlow</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 13, color: '#94a3b8' }}>
          {elapsed > 0 && (
            <span
              title={isRunning ? 'Time elapsed in this run' : 'How long the last run took'}
              style={{ color: isRunning ? '#00d4ff' : '#94a3b8', fontFamily: 'var(--font-mono)', fontWeight: 600 }}
            >
              {formatTime(elapsed)}
            </span>
          )}
          {isComplete && <span style={{ color: '#00ff88', fontSize: 12.5, fontWeight: 600 }}>Research complete</span>}
          {totalTokens > 0 && (
            <span title="Content tokens generated across all four agents (reasoning tokens excluded)">
              {totalTokens.toLocaleString()} content tokens
            </span>
          )}
        </div>
      </div>
      <p style={{ margin: '7px 0 0 0', fontSize: 13, color: '#94a3b8', lineHeight: 1.55, maxWidth: 860 }}>
        Type in a research topic and four AI agents get to work — one digs up the facts, another spots the patterns, a
        third pokes holes in the logic, and the last one ties it all together into a clean report you can export as PDF,
        Word, or Markdown.
      </p>
    </header>
  )
}
