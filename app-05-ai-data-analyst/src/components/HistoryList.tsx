import type { HistoryEntry } from '../types'

interface HistoryListProps {
  entries: HistoryEntry[]
  disabled: boolean
  onReopen: (entry: HistoryEntry) => void
}

export default function HistoryList({ entries, disabled, onReopen }: HistoryListProps) {
  return (
    <section className="ds-section" aria-labelledby="history-title">
      <div className="ds-section__head ds-section__head--row">
        <h2 id="history-title" className="ds-section__title">Question history</h2>
        <span className="ds-hint ds-num">{entries.length} this session</span>
      </div>
      <p className="ds-section__sub">Questions that drew a chart in this session. Choose one to see its chart and trace again.</p>
      {entries.length === 0 ? (
        <p className="ds-empty">Questions that draw a chart appear here, so you can reopen them.</p>
      ) : (
        <ul className="app-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button type="button" className="app-history-item" disabled={disabled} onClick={() => onReopen(entry)}>
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
