import type { LiveIndicator } from '../lib/liveData'
import type { RunStatus } from '../lib/useAnalysis'

// The dot repeats the badge's state as a mark, so the status never relies on colour alone.
const STATUS_DISPLAY: Record<RunStatus, { label: string; badge: string; dot: string }> = {
  idle: { label: 'Ready', badge: '', dot: '' },
  running: { label: 'Analyzing', badge: 'ds-badge--accent', dot: 'ds-dot--running' },
  complete: { label: 'Complete', badge: 'ds-badge--success', dot: 'ds-dot--ok' },
  failed: { label: 'Failed', badge: 'ds-badge--danger', dot: 'ds-dot--failed' },
  cancelled: { label: 'Stopped', badge: 'ds-badge--warning', dot: 'ds-dot--stopped' },
}

export default function Header({ status, live }: { status: RunStatus; live: LiveIndicator }) {
  const display = STATUS_DISPLAY[status]
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="ds-brand">
          <div className="ds-brand__row">
            <span className="ds-plate" role="img" aria-label="App 08">
              08
            </span>
            <h1 className="ds-title">VisionLab</h1>
            <span className={`ds-badge ${display.badge}`}>
              <span className={`ds-dot ${display.dot}`} aria-hidden="true" />
              {display.label}
            </span>
          </div>
          <p className="ds-chip live-data" data-state={live.state} role="status" aria-live="polite" title={live.title}>
            <span className={`ds-dot ${live.state === 'live' ? 'ds-dot--ok' : live.state === 'failed' ? 'ds-dot--failed' : 'ds-dot--skipped'}`} aria-hidden="true" />
            {live.label}
          </p>
          <p className="ds-subtitle">Ask about a whole picture, a box you draw on it, or two pictures side by side.</p>
        </div>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a multimodal call on a crop cut in the browser at full resolution, and a
          two-image comparison, each streamed and checked for completeness before it is marked done.
        </p>
      </div>
    </header>
  )
}
