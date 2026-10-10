import { liveDataOf } from '../lib/liveData'
import type { RunState } from '../lib/runState'

type Phase = RunState['phase']

const BADGE: Record<Phase, { label: string; tone: string; dot: string }> = {
  idle: { label: 'Idle', tone: '', dot: 'ds-dot' },
  planning: { label: 'Planning', tone: 'ds-badge--accent', dot: 'ds-dot ds-dot--running' },
  running: { label: 'Running', tone: 'ds-badge--accent', dot: 'ds-dot ds-dot--running' },
  complete: { label: 'Complete', tone: 'ds-badge--success', dot: 'ds-dot ds-dot--ok' },
  failed: { label: 'Failed', tone: 'ds-badge--danger', dot: 'ds-dot ds-dot--failed' },
  stopped: { label: 'Stopped', tone: 'ds-badge--warning', dot: 'ds-dot ds-dot--skipped' },
}

export default function Header({ state }: { state: RunState }) {
  const badge = BADGE[state.phase]
  const live = liveDataOf(state)
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="ds-brand">
          <div className="ds-brand__row">
            <span className="ds-plate" role="img" aria-label="App 10">10</span>
            <h1 className="ds-title">BrowseBot</h1>
            <span className={`ds-badge ${badge.tone}`.trim()}>
              <span className={badge.dot} aria-hidden="true" />
              {badge.label}
            </span>
          </div>
          <p className="ds-subtitle">
            A model plans browser steps. A headless Chromium runs them on allowed sites, and you replay each step as a picture of the real page.
          </p>
          <p className="live-data" data-state={live.state} role="status" aria-live="polite" title={live.title}>
            <span className={`ds-dot ${live.state === 'live' ? 'ds-dot--ok' : live.state === 'failed' ? 'ds-dot--failed' : 'ds-dot--skipped'}`} aria-hidden="true" />
            {live.text}
          </p>
        </div>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a planner that acts on the live web inside a bounded, allowlisted browser.
          After every step the server captures the page, so the replay shows what the browser saw, beside the text it read, and a failed step shows the page it failed on.
        </p>
      </div>
    </header>
  )
}
