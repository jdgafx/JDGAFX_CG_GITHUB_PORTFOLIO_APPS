import type { HistoryEntry } from '../types'

interface HistoryListProps {
  entries: HistoryEntry[]
  disabled: boolean
  onReopen: (entry: HistoryEntry) => void
}

export default function HistoryList({ entries, disabled, onReopen }: HistoryListProps) {
  return (
    <section className="ds-card" aria-labelledby="history-title">
      <div className="ds-card__head">
        <h2 id="history-title" className="ds-card__title">Question history</h2>
        <span className="ds-hint">{entries.length} this session</span>
      </div>
      {entries.length === 0 ? (
        <p className="ds-empty">Questions that draw a chart are kept here for this session, so you can reopen them.</p>
      ) : (
        <ul className="app-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="ds-button app-history-item"
                disabled={disabled}
                onClick={() => onReopen(entry)}
              >
                <span>{entry.result.question}</span>
                <span className="ds-hint">
                  {entry.result.dataset}, {entry.result.queryPlan.chartType} chart, {entry.result.labels.length} groups,{' '}
                  {entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
