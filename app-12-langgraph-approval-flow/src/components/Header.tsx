import type { Phase } from '../lib/run-state'

const PHASE_BADGE: Record<Phase, { label: string; tone: string; dot: string }> = {
  idle: { label: 'Ready', tone: '', dot: '' },
  running: { label: 'Running', tone: 'accent', dot: 'ds-dot--running' },
  paused: { label: 'Awaiting approval', tone: 'warning', dot: 'gg-dot--waiting' },
  done: { label: 'Completed', tone: 'success', dot: 'ds-dot--ok' },
  failed: { label: 'Failed', tone: 'danger', dot: 'ds-dot--failed' },
}

/** The page header: the app, one line on what it does, the showcase callout, and the state of the run. */
export function Header({ phase }: { phase: Phase }) {
  const badge = PHASE_BADGE[phase]
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <h1 className="ds-title">GraphGate</h1>
        <span className={badge.tone ? `ds-badge ds-badge--${badge.tone}` : 'ds-badge'}>
          <span className={`ds-dot ${badge.dot}`} aria-hidden="true" />
          {badge.label}
        </span>
        <p className="ds-subtitle">A refund agent for support tickets. It pauses for a person on large refunds.</p>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a graph that pauses for a human with <code>interrupt()</code>, saves its
          checkpoint, and resumes from it after a reload.
        </p>
      </div>
    </header>
  )
}
