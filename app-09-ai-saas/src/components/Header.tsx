import LiveChip, { type LiveState } from './LiveChip'

type Phase = 'idle' | 'running' | 'done' | 'failed'

const BADGE: Record<Phase, { badge: string; dot: string; word: string }> = {
  idle: { badge: '', dot: '', word: '' },
  running: { badge: 'ds-badge--accent', dot: 'ds-dot--running', word: 'Explaining' },
  done: { badge: 'ds-badge--success', dot: 'ds-dot--ok', word: 'Explained' },
  failed: { badge: 'ds-badge--danger', dot: 'ds-dot--failed', word: 'Run failed' },
}

export default function Header({ phase, live }: { phase: Phase; live: LiveState }) {
  const badge = BADGE[phase]
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="ds-brand">
          <div className="ds-brand__row">
            <span className="ds-plate" role="img" aria-label="App 09">
              09
            </span>
            <h1 className="ds-title">InsightHub</h1>
            {badge.word !== '' && (
              <span className={`ds-badge ${badge.badge}`}>
                <span className={`ds-dot ${badge.dot}`} aria-hidden="true" />
                {badge.word}
              </span>
            )}
          </div>
          <LiveChip state={live} />
          <p className="ds-subtitle">Compare npm packages by real daily downloads. Unusual days are marked and matched to the releases just before them.</p>
        </div>
      </div>
    </header>
  )
}
