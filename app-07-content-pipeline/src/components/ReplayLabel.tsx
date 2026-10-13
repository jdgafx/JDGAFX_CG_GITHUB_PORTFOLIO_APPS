import { replayLabel } from '../replay'
import { formatUsd } from '../lib/run'
import type { ReplayInfo } from '../lib/useReplay'

interface ReplayLabelProps {
  info: ReplayInfo
  onRunLive: () => void
}

// Says plainly that the run on screen is a recording, with the age, model and cost taken from that recording. The cost is
// written the way the run totals write it, so the label and the readout show the same figure.
export function ReplayLabel({ info, onRunLive }: ReplayLabelProps) {
  const label = replayLabel(info.recording, info.startedAt, info.speed)
  return (
    <div className="replay-label ds-card" role="status" data-replay-label>
      <p className="replay-label__line">
        <strong>Replay of a real run</strong>
        <span aria-hidden="true"> · </span>
        <span data-replay-age>{label.age}</span>
        <span aria-hidden="true"> · </span>
        <span data-replay-model>{label.model}</span>
        <span aria-hidden="true"> · </span>
        <span data-replay-cost>{info.recording.reported.cost_scope} {formatUsd(info.recording.reported.cost_usd)}</span>
        <span aria-hidden="true"> · </span>
        <button type="button" className="ds-button replay-label__live" onClick={onRunLive}>
          Run it live
        </button>
      </p>
      {label.speedNote && <p className="ds-help" data-replay-speed>{label.speedNote}</p>}
      <p className="ds-help">Recorded from the live site. The citation marks are the check results of that run; Run it live makes new requests.</p>
    </div>
  )
}
