import { HOSTS, liveText, type LiveData } from '../lib/liveData'
import type { Badge } from '../lib/view'

export default function Header({ badge, live }: { badge: Badge; live: LiveData }) {
  const tone = badge.tone === 'muted' ? 'ds-badge' : `ds-badge ds-badge--${badge.tone}`
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="ds-brand">
          <div className="ds-brand__row">
            <span className="ds-plate" role="img" aria-label="App 04">
              04
            </span>
            <h1 className="ds-title">VoxAI</h1>
            <span className={tone}>
              <span className={badge.dot} aria-hidden="true" />
              {badge.label}
            </span>
          </div>
          <p className="ds-subtitle">
            Ask by voice or by typing. The answer streams in and is spoken sentence by sentence, with the time to the first spoken word measured.
          </p>
          <p className="live-data ds-chip" data-state={live.state} role="status" aria-live="polite" title={HOSTS}>
            <span className={live.state === 'live' ? 'ds-dot ds-dot--ok' : live.state === 'failed' ? 'ds-dot ds-dot--failed' : 'ds-dot'} aria-hidden="true" />
            {liveText(live)}
          </p>
        </div>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a streaming voice loop. Deepgram hears the question, the model streams its reply over server-sent events,
          live weather and Wikipedia are called as tools, and the browser starts speaking at the first full sentence while the rest is still arriving.
        </p>
      </div>
    </header>
  )
}
