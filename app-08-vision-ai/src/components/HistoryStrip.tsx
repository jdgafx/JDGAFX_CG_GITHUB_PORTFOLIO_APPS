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
    <section className="history" aria-labelledby="history-title">
      <div className="history__head">
        <h2 id="history-title" className="ds-card__title">
          Recent analyses
        </h2>
        <button type="button" className="ds-button" onClick={onClear}>
          Clear history
        </button>
      </div>
      <p className="ds-hint">Up to 12 completed analyses are kept until the page reloads.</p>

      <ul className="history__list">
        {items.map(item => (
          <li key={item.id}>
            <button
              type="button"
              className="history__item"
              onClick={() => onSelect(item)}
              disabled={disabled}
              aria-current={item.id === activeId ? 'true' : undefined}
              aria-label={`Reopen ${item.name}, ${MODE_LABELS[item.mode]} analysis`}
            >
              <img src={item.previewUrl} alt="" />
              <span>{item.name}</span>
              <span className="history__mode">{MODE_LABELS[item.mode]}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
