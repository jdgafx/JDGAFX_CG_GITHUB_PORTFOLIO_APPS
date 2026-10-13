import { replayLabel } from '../replay'
import { formatCost, shortModel } from '../lib/format'
import type { ReplayInfo } from '../lib/useReplay'
import type { RunView } from '../types'

interface ReplayLabelProps {
  info: ReplayInfo
  onRunLive: () => void
  disabled: boolean
}

/** Says plainly that the plan on screen is a recording, with the age, model and cost taken from that recording. */
export function ReplayLabel({ info, onRunLive, disabled }: ReplayLabelProps) {
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
        <span data-replay-cost>{label.cost}</span>
        <span aria-hidden="true"> · </span>
        <button type="button" className="ds-button replay-label__live" onClick={onRunLive} disabled={disabled}>
          Run it live
        </button>
      </p>
      {label.speedNote && <p className="ds-help" data-replay-speed>{label.speedNote}</p>}
      <p className="ds-help">The plan is the one the model wrote in that run. The chart is computed now, in this browser, from the live rows just fetched.</p>
    </div>
  )
}

/** After Run it live: the label of the real run on screen, with the model and cost that run reported. */
export function LiveRunLabel({ run }: { run: RunView }) {
  return (
    <div className="replay-label ds-card" role="status" data-live-label>
      <p className="replay-label__line">
        <strong>Live run</strong>
        <span aria-hidden="true"> · </span>
        <span data-live-model>{run.model ? `served by ${shortModel(run.model)}` : 'model not reported'}</span>
        <span aria-hidden="true"> · </span>
        <span data-live-cost>{run.usage.cost === undefined ? 'cost not reported' : `whole run ${formatCost(run.usage.cost)}`}</span>
      </p>
      <p className="ds-help">A real request made just now, not a recording.</p>
    </div>
  )
}
