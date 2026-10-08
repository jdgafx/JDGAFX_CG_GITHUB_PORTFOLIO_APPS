import type { Phase } from '../lib/run-state'

const PHASE_BADGE: Record<Phase, { label: string; tone: 'neutral' | 'accent' | 'warning' | 'success' | 'danger' }> = {
  idle: { label: 'Ready', tone: 'neutral' },
  running: { label: 'Running', tone: 'accent' },
  paused: { label: 'Awaiting approval', tone: 'warning' },
  done: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
}

export function Header({ phase }: { phase: Phase }) {
  const badge = PHASE_BADGE[phase]
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div>
          <div className="ds-title">GraphGate</div>
          <div className="ds-subtitle">A refund agent that pauses for a person, with checkpoints in Netlify Blobs</div>
        </div>
        <span className={`ds-badge ds-badge--${badge.tone}`}>{badge.label}</span>
      </div>
    </header>
  )
}
