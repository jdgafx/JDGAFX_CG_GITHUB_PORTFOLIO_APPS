import { usd } from '../lib/format'
import { replayLabel, type Recording } from '../replay'

interface ReplayLabelProps {
  recording: Recording
  /** When the page loaded: the age is counted from then. */
  loadedAt: number
  onRunLive: () => void
}

/** The cost the readout shows for this review: every recorded reply's own cost added up, or null when any reply reports none. */
export function recordedCost(recording: Recording): number | null {
  let total = 0
  for (const exchange of recording.exchanges) {
    try {
      const cost = (JSON.parse(exchange.chunks.map((c) => c.text).join('')) as { usage?: { cost?: unknown } }).usage?.cost
      if (typeof cost !== 'number' || !Number.isFinite(cost)) return null
      total += cost
    } catch {
      return null
    }
  }
  return total
}

// Says plainly that the review on screen is a recording, with the age, model and cost taken from that recording.
export function ReplayLabel({ recording, loadedAt, onRunLive }: ReplayLabelProps) {
  const label = replayLabel(recording, loadedAt, 1)
  const total = recordedCost(recording)
  // The same figure the Cost cell shows once the replay ends; if a reply carried none, the one cost the recording reports.
  const cost = total === null ? label.cost : `cost ${usd(total)}, both passes`
  return (
    <div className="replay-label" role="status" data-replay-label>
      <p className="replay-label__line">
        <strong>Replay of a real run</strong>
        <span aria-hidden="true"> · </span>
        <span data-replay-age>{label.age}</span>
        <span aria-hidden="true"> · </span>
        <span data-replay-model>{label.model}</span>
        <span aria-hidden="true"> · </span>
        <span data-replay-cost>{cost}</span>
        <span aria-hidden="true"> · </span>
        <button type="button" className="ds-button replay-label__live" onClick={onRunLive}>
          Run it live
        </button>
      </p>
      <p className="ds-help">Recorded from the live site. The file is fetched from GitHub now; the review is the recorded one, and nothing is sent to the model.</p>
    </div>
  )
}
