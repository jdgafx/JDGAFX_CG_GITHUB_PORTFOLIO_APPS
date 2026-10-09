import { PHASE_BADGE } from '../lib/phase'
import { LIVE_DATA_HOSTS, type LiveData } from '../lib/live-data'
import type { Phase } from '../lib/run-state'

/** The masthead: the app, one line on what it does, the showcase band, and the state of the run. */
export function Header({ phase, live }: { phase: Phase; live: LiveData }) {
  const badge = PHASE_BADGE[phase]
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="ds-brand">
          <div className="ds-brand__row">
            <span className="ds-plate" role="img" aria-label="App 12">
              12
            </span>
            <h1 className="ds-title">GraphGate</h1>
            <span className={badge.tone ? `ds-badge ds-badge--${badge.tone}` : 'ds-badge'}>
              <span className={`ds-dot ${badge.dot}`} aria-hidden="true" />
              {badge.word}
            </span>
          </div>
          <p className="live-data" data-state={live.state} role="status" aria-live="polite" title={LIVE_DATA_HOSTS}>
            <span className={`ds-dot ${live.state === 'live' ? 'ds-dot--ok' : live.state === 'failed' ? 'ds-dot--failed' : 'ds-dot--skipped'}`} aria-hidden="true" />
            {live.state === 'failed' ? <span aria-hidden="true">! </span> : null}
            {live.text}
          </p>
          <p className="ds-subtitle">
            Triage a live public GitHub issue. The graph searches the repository for duplicates, proposes labels and a reply,
            and pauses for a maintainer before anything is final. Drafts only: nothing is posted to GitHub.
          </p>
        </div>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> duplicate detection that shows its evidence. Candidates are ranked by rare shared
          words, the model judges the top few, and a duplicate counts only when both of its quotes are found in the issue texts.
          The run pauses with <code>interrupt()</code>, saves its checkpoint, and resumes after a reload.
        </p>
      </div>
    </header>
  )
}
