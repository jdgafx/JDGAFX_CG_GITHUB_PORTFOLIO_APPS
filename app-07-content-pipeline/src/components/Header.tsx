import type { LiveIndicator } from '../lib/liveData'
import type { Phase } from '../lib/run'

interface HeaderProps {
  phase: Phase
  badge: { text: string; tone: string; dot: string }
  live: LiveIndicator
}

export default function Header({ badge, live }: HeaderProps) {
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="ds-brand">
          <div className="ds-brand__row">
            <span className="ds-plate" role="img" aria-label="App 07">07</span>
            <h1 className="ds-title">ContentForge</h1>
            <span className={`ds-badge ${badge.tone}`}>
              <span className={`ds-dot ${badge.dot}`} aria-hidden="true" />
              {badge.text}
            </span>
          </div>
          <p className="ds-chip live-data" data-state={live.state} role="status" aria-live="polite" title={live.title}>
            <span className={`ds-dot ${live.state === 'live' ? 'ds-dot--ok' : live.state === 'failed' ? 'ds-dot--failed' : 'ds-dot--skipped'}`} aria-hidden="true" />
            {live.label}
          </p>
          <p className="ds-subtitle">A live source lookup and five AI steps turn a topic into a cited piece, and show every change on the way.</p>
        </div>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a resumable six-step writing pipeline grounded in live Wikipedia and Hacker News sources, with tracked changes between Draft, Edit and Polish, each change explained and checked against the text.
        </p>
      </div>
    </header>
  )
}
