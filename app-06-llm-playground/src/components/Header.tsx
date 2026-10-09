import type { CatalogueResponse } from '../../netlify/shared/contract'
import type { RunView } from '../lib/run'

interface HeaderProps {
  catalogue: CatalogueResponse | null
  catalogueFailed: boolean
  run: RunView | null
}

interface Tone {
  badge: string
  dot: string
  label: string
}

// The badge follows the run: success only when every panel answered, warning for a partial finish,
// a vote to cast, or a stop; danger for a failure. The word always says it, never the colour alone.
function toneFor({ catalogue, catalogueFailed, run }: HeaderProps): Tone {
  if (run) {
    switch (run.status) {
      case 'running':
        return { badge: '', dot: 'arena-dot--live', label: run.compare ? 'Judging' : 'Running' }
      case 'voting':
        return { badge: '', dot: 'arena-dot--neutral', label: 'Your vote' }
      case 'error':
        return { badge: 'ds-badge--danger', dot: 'ds-dot--failed', label: 'Failed' }
      case 'stopped':
        return { badge: 'ds-badge--warning', dot: 'ds-dot--stopped', label: 'Stopped' }
      case 'done': {
        const all = run.compare?.panels.every(p => p.ok) ?? false
        return all
          ? { badge: 'ds-badge--success', dot: 'ds-dot--ok', label: run.vote.state === 'counted' ? 'Vote counted' : 'Complete' }
          : { badge: 'ds-badge--warning', dot: 'ds-dot--stopped', label: 'Partial' }
      }
    }
  }
  if (catalogueFailed) return { badge: 'ds-badge--danger', dot: 'ds-dot--failed', label: 'Model list unavailable' }
  if (!catalogue) return { badge: '', dot: '', label: 'Loading model list' }
  if (catalogue.source === 'live') return { badge: '', dot: 'ds-dot--ok', label: 'Live model list' }
  return { badge: 'ds-badge--warning', dot: 'ds-dot--stopped', label: catalogue.source === 'cached' ? 'Cached model list' : 'Fallback model list' }
}

export function Header(props: HeaderProps) {
  const tone = toneFor(props)
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="ds-brand">
          <div className="ds-brand__row">
            <span className="ds-plate" role="img" aria-label="App 06">
              06
            </span>
            <h1 className="ds-title">ModelArena</h1>
            <span className={`ds-badge ${tone.badge}`}>
              <span className={`ds-dot ${tone.dot}`} aria-hidden="true" />
              {tone.label}
            </span>
          </div>
          <p className="ds-subtitle">
            Put one prompt to three models, vote for the best answer without knowing who wrote it, and watch the shared
            leaderboard move.
          </p>
        </div>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a blind arena. Votes from every visitor are stored on the server and
          turned into Elo ratings, and the models are named only after you vote.
        </p>
      </div>
    </header>
  )
}
