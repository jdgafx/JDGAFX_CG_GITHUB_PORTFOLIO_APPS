import { replayLabel } from '../replay'
import { usd } from '../lib/format'
import type { ReplayInfo } from '../lib/useReplay'
import type { LatestRun } from '../types'

interface ReplayLabelProps {
  info: ReplayInfo
  onRunLive: () => void
  disabled: boolean
}

// Says plainly that the answer on screen is a recording, with the age, model and cost taken from that recording.
export function ReplayLabel({ info, onRunLive, disabled }: ReplayLabelProps) {
  const label = replayLabel(info.recording, info.startedAt, info.speed)
  return (
    <div className="run-banner ds-card" role="status" data-replay-label>
      <div className="run-banner__row">
        <p className="run-banner__line">
          <strong>Replay of a real run</strong>
          <span aria-hidden="true"> · </span>
          <span className="run-banner__fact" data-replay-age>{label.age}</span>
          <span aria-hidden="true"> · </span>
          <span className="run-banner__fact" data-replay-model>{label.model}</span>
          <span aria-hidden="true"> · </span>
          <span className="run-banner__fact" data-replay-cost>{label.cost}</span>
        </p>
        <button type="button" className="ds-button run-banner__action" onClick={onRunLive} disabled={disabled}>
          Run it live
        </button>
      </div>
      {label.speedNote && <p className="ds-help" data-replay-speed>{label.speedNote}</p>}
      <p className="ds-help">The answer was recorded from the live site. The article was fetched from Wikipedia just now, and no model was called for this view.</p>
    </div>
  )
}

interface LiveLabelProps {
  report: LatestRun['report']
}

// The same slot once the answer on screen is a live run: the model that served it and what it cost, as the run reported them.
export function LiveLabel({ report }: LiveLabelProps) {
  const cost = typeof report.usage?.cost === 'number' ? `this question ${usd(report.usage.cost)}` : 'cost not reported'
  return (
    <div className="run-banner ds-card" role="status" data-live-label>
      <div className="run-banner__row">
        <p className="run-banner__line">
          <strong>Live run</strong>
          <span aria-hidden="true"> · </span>
          <span className="run-banner__fact" data-live-model>{`answered by ${report.servedModel ?? 'a model that was not named'}`}</span>
          <span aria-hidden="true"> · </span>
          <span className="run-banner__fact" data-live-cost>{cost}</span>
        </p>
      </div>
      <p className="ds-help">A model call made just now answered this question.</p>
    </div>
  )
}
