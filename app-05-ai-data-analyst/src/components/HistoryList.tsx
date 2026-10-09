import { drawnLine } from '../lib/format'
import type { Thread } from '../types'

interface HistoryListProps {
  /** The threads other than the one on screen, newest first. */
  threads: Thread[]
  disabled: boolean
  onOpen: (id: string) => void
}

/** Earlier analyses of this session. Choose one to bring its thread, chart and trace back. */
export default function HistoryList({ threads, disabled, onOpen }: HistoryListProps) {
  // With nothing earlier there is nothing to say: an empty box here only pushes the page down.
  if (threads.length === 0) return null
  return (
    <section className="ds-section" aria-labelledby="history-title">
      <div className="ds-section__head ds-section__head--bare ds-section__head--row">
        <h2 id="history-title" className="ds-section__title">Earlier analyses</h2>
        <span className="ds-hint ds-num">{threads.length} this session</span>
      </div>
      <ul className="app-list">
          {threads.map((thread) => {
            const first = thread.steps[0]
            const last = thread.steps[thread.steps.length - 1]
            if (!first || !last) return null
            return (
              <li key={thread.id}>
                <button type="button" className="app-history-item" disabled={disabled} onClick={() => onOpen(thread.id)}>
                  <span>{first.question}</span>
                  <span className="ds-hint">
                    {thread.dataset}, {thread.steps.length} {thread.steps.length === 1 ? 'step' : 'steps'}, last: {drawnLine(last.result)},{' '}
                    {last.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
    </section>
  )
}
