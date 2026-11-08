import type { LiveDataView } from '../lib/liveData'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

interface HeaderProps {
  badgeLabel: string
  badgeTone: BadgeTone
  live: LiveDataView
}

const DOT: Record<BadgeTone, string> = {
  neutral: '',
  accent: 'ds-dot--running',
  success: 'ds-dot--ok',
  warning: 'ds-dot--stopped',
  danger: 'ds-dot--failed',
}

/** The masthead: the mark and name, the run status, and the data chip that says whether the sources on screen are live or recorded. */
export function Header({ badgeLabel, badgeTone, live }: HeaderProps) {
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="relay-brand">
          <span className="relay-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M13 2L3 14h7v8l11-12h-8z" fill="currentColor" />
            </svg>
          </span>
          <p className="relay-wordmark">AgentFlow</p>
          <span className={badgeTone === 'neutral' ? 'ds-badge' : `ds-badge ds-badge--${badgeTone}`}>
            <span className={`ds-dot ${DOT[badgeTone]}`} aria-hidden="true" />
            {badgeLabel}
          </span>
        </div>
        <p className="ds-chip live-data" data-state={live.state} role="status" aria-live="polite" title={live.title}>
          <span className={`ds-dot ${live.state === 'live' ? 'ds-dot--ok' : live.state === 'failed' ? 'ds-dot--failed' : 'ds-dot--skipped'}`} aria-hidden="true" />
          {live.text}
        </p>
      </div>
    </header>
  )
}
