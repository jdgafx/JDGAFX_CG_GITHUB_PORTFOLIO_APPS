import type { Phase } from '../lib/run'

interface HeaderProps {
  phase: Phase
  badge: { text: string; tone: string; dot: string }
}

export default function Header({ badge }: HeaderProps) {
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
          <p className="ds-subtitle">A live source lookup and five AI steps turn a topic into a cited piece, and show every change on the way.</p>
        </div>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a resumable six-step writing pipeline grounded in live Wikipedia and Hacker News sources, with tracked changes between Draft, Edit and Polish, each change explained and checked against the text.
        </p>
      </div>
    </header>
  )
}
