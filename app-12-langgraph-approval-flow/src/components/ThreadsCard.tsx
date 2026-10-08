import type { ThreadEntry, ThreadStatus } from '../types'
import { formatUsd } from '../lib/format'
import { MEMORY_NOTE } from '../constants'

export interface ThreadsState {
  loading: boolean
  storage: 'blobs' | 'memory' | null
  notice: string | null
  items: ThreadEntry[]
  error: string | null
}

const STATUS_TEXT: Record<ThreadStatus, string> = {
  awaiting_approval: 'Awaiting approval',
  completed: 'Completed',
  failed: 'Failed',
}

interface ThreadsCardProps {
  state: ThreadsState
  busy: boolean
  onRefresh: () => void
  onOpen: (threadId: string) => void
}

/** The saved threads. A thread that is waiting can be opened here, even after a reload. */
export function ThreadsCard({ state, busy, onRefresh, onOpen }: ThreadsCardProps) {
  return (
    <section className="ds-card" aria-labelledby="threads-heading">
      <div className="ds-card__head">
        <h2 id="threads-heading" className="ds-card__title">Threads</h2>
        <button type="button" className="ds-button" disabled={busy || state.loading} onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {state.storage === 'memory' ? (
        <p className="ds-notice" role="status">
          {state.notice ?? MEMORY_NOTE}
        </p>
      ) : null}
      {state.loading ? <p className="ds-hint">Loading threads...</p> : null}
      {state.error ? (
        <p className="ds-notice ds-notice--error" role="alert">
          {state.error}
        </p>
      ) : null}
      {!state.loading && !state.error && state.items.length === 0 ? (
        <div className="ds-empty">No threads yet. Run a ticket to start one.</div>
      ) : null}

      <ul className="gg-threads">
        {state.items.map((item) => (
          <li key={item.id} className="gg-thread">
            <div className="gg-thread__text">
              <div className="gg-thread__title">{item.title}</div>
              <div className="ds-hint">
                {STATUS_TEXT[item.status]}
                {item.amount !== null ? `, ${formatUsd(item.amount)}` : ''}, {new Date(item.updatedAt).toLocaleString()}
              </div>
            </div>
            <button
              type="button"
              className="ds-button"
              disabled={busy}
              onClick={() => onOpen(item.id)}
              aria-label={`Open ${item.title}`}
            >
              {item.status === 'awaiting_approval' ? 'Open to approve' : 'Open'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
