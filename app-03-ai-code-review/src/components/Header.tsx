import type { RunPhase } from '../types'
import type { VerdictCounts } from '../lib/verdicts'

export interface StatusBadge {
  text: string
  tone: string
  /** The dot class that repeats the state. The word always carries the meaning on its own. */
  dot: string
}

/**
 * The header badge: what the app is doing now, in words. Success is only for a review the second pass completed with
 * nothing left unconfirmed; a partly verified review is a warning.
 */
export function statusBadge(phase: RunPhase, verified: boolean, counts: VerdictCounts | null): StatusBadge {
  if (phase === 'running') return { text: 'Reviewing', tone: 'ds-badge--accent', dot: 'ds-dot--running' }
  if (phase === 'failed') return { text: 'Failed', tone: 'ds-badge--danger', dot: 'ds-dot--failed' }
  if (phase === 'stopped') return { text: 'Stopped', tone: 'ds-badge--warning', dot: 'ds-dot--stopped' }
  if (phase === 'done' && counts) {
    return verified && counts.unverified === 0
      ? { text: 'Verified', tone: 'ds-badge--success', dot: 'ds-dot--ok' }
      : { text: 'Partly verified', tone: 'ds-badge--warning', dot: 'ds-dot--stopped' }
  }
  return { text: 'Ready', tone: '', dot: '' }
}

export function Header({ badge }: { badge: StatusBadge }) {
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="ds-brand">
          <div className="ds-brand__row">
            <span className="ds-plate" role="img" aria-label="App 03">
              03
            </span>
            <h1 className="ds-title">CodeLens AI</h1>
            <span className={`ds-badge ${badge.tone}`}>
              <span className={`ds-dot ${badge.dot}`} aria-hidden="true" />
              {badge.text}
            </span>
          </div>
          <p className="ds-subtitle">
            Review a source file or a public GitHub pull request. A second model pass checks every comment against the code.
          </p>
        </div>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a verified review. Each first-pass comment is kept, moved to the line it is
          really about, or dropped with a reason that quotes the code, and every verdict is re-checked against the source.
        </p>
      </div>
    </header>
  )
}
