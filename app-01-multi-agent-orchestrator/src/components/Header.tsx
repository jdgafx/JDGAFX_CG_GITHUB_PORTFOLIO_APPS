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

export function Header({ badgeLabel, badgeTone, live }: HeaderProps) {
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="ds-brand">
          <div className="ds-brand__row">
            <span className="ds-plate" role="img" aria-label="App 01">
              01
            </span>
            <h1 className="ds-title">AgentFlow</h1>
            <span className={badgeTone === 'neutral' ? 'ds-badge' : `ds-badge ds-badge--${badgeTone}`}>
              <span className={`ds-dot ${DOT[badgeTone]}`} aria-hidden="true" />
              {badgeLabel}
            </span>
          </div>
          <p className="ds-chip live-data" data-state={live.state} role="status" aria-live="polite" title={live.title}>
            <span className={`ds-dot ${live.state === 'live' ? 'ds-dot--ok' : live.state === 'failed' ? 'ds-dot--failed' : 'ds-dot--skipped'}`} aria-hidden="true" />
            {live.text}
          </p>
          <p className="ds-subtitle">Looks a question up on Wikipedia and Hacker News, answers it with four agents, then checks every cited sentence against its source.</p>
        </div>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a fixed multi-agent pipeline grounded in live public sources, and an audit of the final report that marks each
          cited claim supported, partly supported or not supported, with the sentence of the source that backs it.
        </p>
      </div>
    </header>
  )
}
