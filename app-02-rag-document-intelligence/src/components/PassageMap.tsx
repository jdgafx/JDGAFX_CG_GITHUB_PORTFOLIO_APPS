import { mapCells, sentSummary, viewRange, type MapCell } from '../lib/passageMap'
import type { RunState } from '../types'

interface PassageMapProps {
  total: number
  /** Passages the browser sent to the model for the latest question. */
  sent: number[]
  /** Passages the latest answer cites. */
  citedLatest: number[]
  latestState: RunState | null
  /** The list window: passages from `start` up to, not including, `end`. */
  start: number
  end: number
}

/** The whole document as a ruler. Shaded cells went to the model, solid cells are cited. */
export function PassageMap({ total, sent, citedLatest, latestState, start, end }: PassageMapProps) {
  const cells = mapCells(total, sent, citedLatest)
  const view = viewRange(total, start, end)

  return (
    <div className="ds-scroll-x">
      <div className="docmind-map">
        <p className="ds-help">{sentSummary(total, sent, citedLatest, latestState)}</p>
        <div className="docmind-map__track" aria-hidden="true">
          {cells.map((cell, i) => (
            <span key={i} className={cellClass(cell)} />
          ))}
          <span className="docmind-map__view" style={{ left: `${view.left}%`, width: `${view.width}%` }} />
        </div>
        <p className="docmind-map__ruler ds-hint" aria-hidden="true">
          <span>Passage 1</span>
          <span>Passage {total.toLocaleString('en-US')}</span>
        </p>
      </div>
    </div>
  )
}

function cellClass(cell: MapCell): string {
  if (cell.cited) return 'docmind-map__cell docmind-map__cell--cited'
  if (cell.sent) return 'docmind-map__cell docmind-map__cell--sent'
  return 'docmind-map__cell'
}
