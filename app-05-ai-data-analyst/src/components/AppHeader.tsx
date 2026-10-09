import type { LiveIndicator } from '../lib/liveData/indicator'

export type HeaderStatus = 'idle' | 'running' | 'done' | 'failed' | 'stopped'

const STATUS: Record<HeaderStatus, { label: string; tone: string; dot: string }> = {
  idle: { label: 'Ready for a question', tone: '', dot: '' },
  running: { label: 'Planning and running', tone: 'ds-badge--accent', dot: 'ds-dot--running' },
  done: { label: 'Last run completed', tone: 'ds-badge--success', dot: 'ds-dot--ok' },
  failed: { label: 'Last run failed', tone: 'ds-badge--danger', dot: 'ds-dot--failed' },
  stopped: { label: 'Last run stopped', tone: 'ds-badge--warning', dot: 'ds-dot--stopped' },
}

export default function AppHeader({ status, live }: { status: HeaderStatus; live: LiveIndicator }) {
  const { label, tone, dot } = STATUS[status]
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="ds-brand">
          <div className="ds-brand__row">
            <span className="ds-plate" role="img" aria-label="App 05">05</span>
            <h1 className="ds-title">DataPilot</h1>
            <span className={`ds-badge ${tone}`}>
              <span className={`ds-dot ${dot}`} aria-hidden="true" />
              {label}
            </span>
          </div>
          <p className="ds-chip live-data" data-state={live.state} role="status" aria-live="polite" title={live.title}>
            <span className={`ds-dot ${live.state === 'live' ? 'ds-dot--ok' : live.state === 'failed' ? 'ds-dot--failed' : 'ds-dot--skipped'}`} aria-hidden="true" />
            {live.label}
          </p>
          <p className="ds-subtitle">
            Ask a question about live public data or your own CSV, then keep refining it with follow-ups.
          </p>
        </div>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> the model plans, the browser computes. Each follow-up becomes a new
          plan, checked against the columns and run on every row, with what changed shown as chips.
        </p>
      </div>
    </header>
  )
}
