import { MODE_LABELS } from '../lib/modes'
import type { GalleryItem } from '../lib/useAnalysis'

interface HistoryStripProps {
  items: GalleryItem[]
  activeId: string | null
  disabled: boolean
  onSelect: (item: GalleryItem) => void
  onClear: () => void
}

export default function HistoryStrip({ items, activeId, disabled, onSelect, onClear }: HistoryStripProps) {
  return (
    <section className="ds-section" aria-labelledby="history-title">
      <div className="ds-section__head ds-section__head--row">
        <div>
          <h2 id="history-title" className="ds-section__title">
            Recent analyses
          </h2>
          <p className="ds-section__sub">Up to 12 completed analyses are kept until the page reloads.</p>
        </div>
        <button type="button" className="ds-button" onClick={onClear} disabled={disabled || items.length === 0}>
          Clear history
        </button>
      </div>

      {items.length === 0 ? (
        <div className="ds-empty">Completed analyses appear here. Select one to reopen it with its answer.</div>
      ) : (
        <ul className="history__list">
          {items.map(item => (
            <li key={item.id}>
              <button
                type="button"
                className="history__item"
                onClick={() => onSelect(item)}
                disabled={disabled}
                aria-current={item.id === activeId ? 'true' : undefined}
                aria-label={`Reopen ${item.file.name}, ${MODE_LABELS[item.mode]} analysis`}
              >
                <img src={item.previewUrl} alt="" />
                <span className="history__name">{item.file.name}</span>
                <span className="history__mode">{MODE_LABELS[item.mode]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
