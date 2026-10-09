import type { RunPhase } from '../types'

export interface StatusBadge {
  text: string
  tone: string
  /** The dot class that repeats the state. The word always carries the meaning on its own. */
  dot: string
}

/** The header badge: what the app is doing now, in words. */
export function statusBadge(phase: RunPhase, issueCount: number): StatusBadge {
  if (phase === 'running') return { text: 'Reviewing', tone: 'ds-badge--accent', dot: 'ds-dot--running' }
  if (phase === 'failed') return { text: 'Failed', tone: 'ds-badge--danger', dot: 'ds-dot--failed' }
  if (phase === 'stopped') return { text: 'Stopped', tone: '', dot: '' }
  if (phase === 'done') {
    return issueCount === 0
      ? { text: 'No issues', tone: 'ds-badge--success', dot: 'ds-dot--ok' }
      : {
          text: issueCount === 1 ? '1 issue' : `${issueCount} issues`,
          tone: 'ds-badge--warning',
          dot: 'dot--warning',
        }
  }
  return { text: 'Ready', tone: '', dot: '' }
}

interface HeaderProps {
  badge: StatusBadge
}

export function Header({ badge }: HeaderProps) {
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div>
          <h1 className="ds-title">CodeLens AI</h1>
          <p className="ds-subtitle">Paste code or load a public GitHub file, get a line-by-line review with a suggested fix for each comment.</p>
        </div>
        <span className={`ds-badge ${badge.tone}`}>
          <span className={`ds-dot ${badge.dot}`} aria-hidden="true" />
          {badge.text}
        </span>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a structured JSON review whose line citations are validated against the
          real file before anything is shown.
        </p>
      </div>
    </header>
  )
}
