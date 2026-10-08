import type { RunPhase } from '../types'

/** The header badge: what the app is doing now, in words. */
export function statusBadge(phase: RunPhase, issueCount: number): { text: string; tone: string } {
  if (phase === 'running') return { text: 'Reviewing', tone: 'ds-badge--accent' }
  if (phase === 'failed') return { text: 'Failed', tone: 'ds-badge--danger' }
  if (phase === 'done') {
    return issueCount === 0
      ? { text: 'No issues', tone: 'ds-badge--success' }
      : { text: issueCount === 1 ? '1 issue' : `${issueCount} issues`, tone: 'ds-badge--warning' }
  }
  return { text: 'Ready', tone: '' }
}

interface HeaderProps {
  badge: { text: string; tone: string }
}

export function Header({ badge }: HeaderProps) {
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div>
          <h1 className="ds-title">CodeLens AI</h1>
          <p className="ds-subtitle">Paste code, get a line-by-line review with a suggested fix for each comment.</p>
        </div>
        <span className={`ds-badge ${badge.tone}`}>{badge.text}</span>
      </div>
    </header>
  )
}
