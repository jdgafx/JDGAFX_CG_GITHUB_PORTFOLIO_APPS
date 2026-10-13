import { replayLabel } from '../replay'
import { recordedCost, type ReplayInfo } from '../lib/useReplay'
import { costLabel } from './Readout'

interface ReplayLabelProps {
  info: ReplayInfo
  onRunLive: () => void
  disabled: boolean
}

// Says plainly that the explanations on screen are a recording, with the age and model from that recording and the cost
// counted the way the readout counts it (every recorded explanation call, calls that reported none counted).
export function ReplayLabel({ info, onRunLive, disabled }: ReplayLabelProps) {
  const label = replayLabel(info.recording, info.startedAt, info.speed)
  const { cost, unreported } = recordedCost(info.recording)
  const costWords = cost === null ? 'cost unknown' : `cost ${costLabel(cost, unreported)}`
  return (
    <div className="replay-label ds-card" role="status" data-replay-label>
      <p className="replay-label__line">
        <strong>Replay of a real run</strong>
        <span aria-hidden="true"> · </span>
        <span data-replay-age>{label.age}</span>
        <span aria-hidden="true"> · </span>
        <span data-replay-model>{label.model}</span>
        <span aria-hidden="true"> · </span>
        <span data-replay-cost>{costWords}</span>
        <span aria-hidden="true"> · </span>
        <button type="button" className="ds-button replay-label__live" onClick={onRunLive} disabled={disabled}>
          Run it live
        </button>
      </p>
      {label.speedNote && <p className="ds-help" data-replay-speed>{label.speedNote}</p>}
      <p className="ds-help">
        The explanations, model and cost are from that run. The downloads are npm&apos;s figures for the day it was made, fetched just now, and every figure is checked against them.
      </p>
    </div>
  )
}
