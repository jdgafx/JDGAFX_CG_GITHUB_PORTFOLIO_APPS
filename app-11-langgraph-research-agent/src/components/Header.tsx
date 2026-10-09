import { liveData, statusText, type RunView } from '../lib/runState'

interface Tone {
  badge: string
  dot: string
}

/** The badge follows the run: a partial or unanswered finish is a warning, never a success. */
function toneFor(view: RunView): Tone {
  switch (view.phase) {
    case 'running':
      return { badge: 'ds-badge--accent', dot: 'ds-dot--running' }
    case 'done':
      return view.result?.ending.kind === 'complete' && !(view.result.fork && !(view.result.critic.reviewed && view.result.critic.verdict === 'accept'))
        ? { badge: 'ds-badge--success', dot: 'ds-dot--ok' }
        : { badge: 'ds-badge--warning', dot: 'ds-dot--stopped' }
    case 'failed':
      return { badge: 'ds-badge--danger', dot: 'ds-dot--failed' }
    case 'stopped':
      return { badge: 'ds-badge--warning', dot: 'ds-dot--stopped' }
    case 'idle':
      return { badge: '', dot: '' }
  }
}

interface HeaderProps {
  view: RunView
  /** When the original run first read a page, for a re-run that reads none of its own. */
  earlierLiveAt: number | null
}

const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function Header({ view, earlierLiveAt }: HeaderProps) {
  const tone = toneFor(view)
  const live = liveData(view, earlierLiveAt)
  const dot = live.state === 'live' ? 'ds-dot--ok' : live.state === 'failed' ? 'ds-dot--failed' : 'ds-dot--skipped'
  return (
    <header className="ds-header">
      <div className="ds-header__inner">
        <div className="ds-brand">
          <div className="ds-brand__row">
            <span className="ds-plate" role="img" aria-label="App 11">
              11
            </span>
            <h1 className="ds-title">GraphScout</h1>
            <span className={`ds-badge ${tone.badge}`}>
              <span className={`ds-dot ${tone.dot}`} aria-hidden="true" />
              {statusText(view)}
            </span>
          </div>
          <p className="ds-chip live-data" data-state={live.state} role="status" aria-live="polite" title="en.wikipedia.org">
            <span className={`ds-dot ${dot}`} aria-hidden="true" />
            {live.state === 'failed'
              ? 'Live data unavailable: Wikipedia'
              : live.state === 'live' && live.at !== null
                ? `Live data: Wikipedia · fetched ${clock(live.at)}`
                : 'Live data: Wikipedia'}
          </p>
          <p className="ds-subtitle">
            Ask a factual question. An agent searches Wikipedia, drafts a cited answer, and a critic checks it.
          </p>
        </div>
        <p className="ds-showcase">
          <strong>What this showcases:</strong> a LangGraph agent whose tool loop and critic loop are real cycles in a
          state graph, each bounded and shown as it runs.
        </p>
      </div>
    </header>
  )
}
