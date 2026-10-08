import type { NodeName } from '../../netlify/shared/events'
import type { Phase } from '../lib/runState'

interface Badge {
  text: string
  tone: string
}

function badgeFor(phase: Phase, active: NodeName | null): Badge {
  if (phase === 'running') return { text: `Running: ${active ?? 'starting'}`, tone: 'ds-badge--accent' }
  if (phase === 'done') return { text: 'Answer ready', tone: 'ds-badge--success' }
  if (phase === 'failed') return { text: 'Failed', tone: 'ds-badge--danger' }
  return { text: 'Ready', tone: '' }
}

interface HeaderProps {
  phase: Phase
  active: NodeName | null
}

export function Header({ phase, active }: HeaderProps) {
  const badge = badgeFor(phase, active)
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div>
          <h1 className="ds-title">GraphScout</h1>
          <p className="ds-subtitle">Ask a factual question. An agent searches Wikipedia, drafts a cited answer, and a critic checks it.</p>
        </div>
        <span className={`ds-badge ${badge.tone}`}>{badge.text}</span>
      </div>
    </header>
  )
}
