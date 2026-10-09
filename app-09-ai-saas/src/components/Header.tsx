import type { RunStatus } from '../lib/insightRun'
import { LIVE_HOSTS, liveText, type LiveState } from '../lib/liveData'

interface Tone {
  badge: string
  dot: string
  word: string
}

/** The badge follows the run. Success is for a finished run whose checks passed; a failed check is a warning. */
function toneFor(status: RunStatus, checkFailed: boolean): Tone {
  switch (status) {
    case 'running':
      return { badge: 'ds-badge--accent', dot: 'ds-dot--running', word: 'Explaining' }
    case 'done':
      return checkFailed
        ? { badge: 'ds-badge--warning', dot: 'ds-dot--stopped', word: 'Done, a check failed' }
        : { badge: 'ds-badge--success', dot: 'ds-dot--ok', word: 'Explained' }
    case 'failed':
      return { badge: 'ds-badge--danger', dot: 'ds-dot--failed', word: 'Run failed' }
    case 'stopped':
      return { badge: 'ds-badge--warning', dot: 'ds-dot--stopped', word: 'Stopped' }
    case 'idle':
      return { badge: '', dot: '', word: '' }
  }
}

interface HeaderProps {
  status: RunStatus
  checkFailed: boolean
  live: { state: LiveState; fetchedAt: number | null }
}

export default function Header({ status, checkFailed, live }: HeaderProps) {
  const tone = toneFor(status, checkFailed)
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="ds-brand">
          <div className="ds-brand__row">
            <span className="ds-plate" role="img" aria-label="App 09">
              09
            </span>
            <h1 className="ds-title">InsightHub</h1>
            {tone.word !== '' && (
              <span className={`ds-badge ${tone.badge}`}>
                <span className={`ds-dot ${tone.dot}`} aria-hidden="true" />
                {tone.word}
              </span>
            )}
          </div>
          <p className="live-data ds-chip" data-state={live.state} role="status" aria-live="polite" title={LIVE_HOSTS}>
            <span className={`ds-dot ${live.state === 'live' ? 'ds-dot--ok' : live.state === 'failed' ? 'ds-dot--failed' : 'ds-dot--skipped'}`} aria-hidden="true" />
            {liveText(live.state, live.fetchedAt)}
          </p>
          <p className="ds-subtitle">
            Compare npm packages by real daily downloads. Unusual days are marked and matched to the releases just before them.
          </p>
        </div>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a robust spike detector on live npm downloads, matched to registry release
          history, with a model explanation whose numbers, dates and versions are checked against that evidence.
        </p>
      </div>
    </header>
  )
}
