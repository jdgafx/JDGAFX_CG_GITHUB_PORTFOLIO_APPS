import { MEMORY_NOTE } from '../constants'
import type { ThreadEntry, ThreadStatus } from '../types'

export interface ThreadsState {
  loading: boolean
  storage: 'blobs' | 'memory' | null
  notice: string | null
  items: ThreadEntry[]
  error: string | null
}

const STATUS_TEXT: Record<ThreadStatus, string> = {
  awaiting_approval: 'Awaiting a maintainer',
  completed: 'Completed',
  failed: 'Failed',
}

const STATUS_DOT: Record<ThreadStatus, string> = {
  awaiting_approval: 'gg-dot--waiting',
  completed: 'ds-dot--ok',
  failed: 'ds-dot--failed',
}

interface ThreadsCardProps {
  state: ThreadsState
  busy: boolean
  onRefresh: () => void
  onOpen: (threadId: string) => void
}

/** The saved runs. A reload keeps them, and a run that is waiting can be opened to approve it. */
export function ThreadsCard({ state, busy, onRefresh, onOpen }: ThreadsCardProps) {
  return (
    <section className="ds-section" aria-labelledby="threads-heading">
      <div className="ds-section__head ds-section__head--row">
        <div>
          <h2 id="threads-heading" className="ds-section__title">
            Threads
          </h2>
          <p className="ds-section__sub">
            Each run is saved as it goes. A reload keeps them, so a waiting run can be opened here.
          </p>
        </div>
        <button type="button" className="ds-button" disabled={busy || state.loading} onClick={onRefresh}>
          Refresh list
        </button>
      </div>

      {state.storage === 'memory' ? (
        <p className="ds-notice" role="status">
          {state.notice ?? MEMORY_NOTE}
        </p>
      ) : null}
      {state.loading ? <p className="ds-help">Loading saved runs…</p> : null}
      {state.error ? (
        <p className="ds-notice ds-notice--error" role="alert">
          {state.error}
        </p>
      ) : null}
      {!state.loading && !state.error && state.items.length === 0 ? (
        <div className="ds-empty">No saved runs yet. Triage an issue, and it appears here.</div>
      ) : null}

      <ul className="gg-threads">
        {state.items.map((item) => (
          <li key={item.id} className="gg-thread">
            <div className="gg-thread__text">
              <p className="gg-thread__title">{item.title}</p>
              <p className="ds-hint gg-thread__meta">
                <span className={`ds-dot ${STATUS_DOT[item.status]}`} aria-hidden="true" />
                <span>
                  {STATUS_TEXT[item.status]}
                  {item.priority ? `, ${item.priority} priority` : ''}, {new Date(item.updatedAt).toLocaleString()}
                </span>
              </p>
            </div>
            <button
              type="button"
              className="ds-button"
              disabled={busy}
              onClick={() => onOpen(item.id)}
              aria-label={`Open ${item.title}`}
            >
              {item.status === 'awaiting_approval' ? 'Open to review' : 'Open'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
