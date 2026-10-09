import { describeRect } from '../lib/region'
import type { RegionEntry } from '../lib/useAnalysis'

interface RegionListProps {
  regions: RegionEntry[]
  activeId: string | null
  disabled: boolean
  onSelect: (id: string) => void
}

const STATE_WORD = { running: 'Asking', complete: 'Answered', failed: 'Failed', cancelled: 'Stopped', idle: '' } as const
const STATE_DOT = { running: 'ds-dot--running', complete: 'ds-dot--ok', failed: 'ds-dot--failed', cancelled: 'ds-dot--stopped', idle: '' } as const

// Every box asked about on this picture, in order. Selecting one shows its crop, answer and trace again.
export default function RegionList({ regions, activeId, disabled, onSelect }: RegionListProps) {
  return (
    <section className="ds-section vl-regions" aria-labelledby="regions-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="regions-title" className="ds-section__title">
          Regions asked
        </h2>
        <p className="ds-section__sub">Select one to show its answer. They are lost when you change the picture.</p>
      </div>
      {regions.length === 0 ? (
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">No regions yet</p>
          <p className="ds-state__body">Each box you ask about is listed here with its crop and its answer.</p>
        </div>
      ) : (
        <ol className="vl-regions__list">
          {regions.map(entry => (
            <li key={entry.id}>
              <button
                type="button"
                className="vl-region"
                disabled={disabled}
                aria-current={entry.id === activeId ? 'true' : undefined}
                onClick={() => onSelect(entry.id)}
              >
                {entry.cropUrl ? (
                  <img src={entry.cropUrl} alt="" className="vl-region__crop" />
                ) : (
                  <span className="vl-region__crop" aria-hidden="true" />
                )}
                <span className="vl-region__text">
                  <span className="vl-region__top">
                    <span className="ds-chip">{entry.tag}</span>
                    <span className="vl-region__state">
                      <span className={`ds-dot ${STATE_DOT[entry.status]}`} aria-hidden="true" />
                      {STATE_WORD[entry.status]}
                    </span>
                    {entry.rect && <span className="ds-mono vl-region__size">{describeRect(entry.rect)}</span>}
                  </span>
                  <span className="vl-region__q">{entry.question}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
