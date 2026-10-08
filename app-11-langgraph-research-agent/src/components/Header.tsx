import { statusText, type Phase, type RunView } from '../lib/runState'

const BADGE: Record<Phase, { tone: string; dot: string }> = {
  idle: { tone: '', dot: '' },
  running: { tone: 'ds-badge--accent', dot: 'ds-dot--running' },
  done: { tone: 'ds-badge--success', dot: 'ds-dot--ok' },
  failed: { tone: 'ds-badge--danger', dot: 'ds-dot--failed' },
  stopped: { tone: 'ds-badge--warning', dot: 'ds-dot--stopped' },
}

interface HeaderProps {
  view: RunView
}

export function Header({ view }: HeaderProps) {
  const badge = BADGE[view.phase]
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div>
          <h1 className="ds-title">GraphScout</h1>
          <p className="ds-subtitle">
            Ask a factual question. An agent searches Wikipedia, drafts a cited answer, and a critic checks it.
          </p>
        </div>
        <span className={`ds-badge ${badge.tone}`}>
          <span className={`ds-dot ${badge.dot}`} aria-hidden="true" />
          {statusText(view)}
        </span>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a LangGraph agent whose tool loop and critic loop are real cycles in a
          state graph, each bounded and shown as it runs.
        </p>
      </div>
    </header>
  )
}
