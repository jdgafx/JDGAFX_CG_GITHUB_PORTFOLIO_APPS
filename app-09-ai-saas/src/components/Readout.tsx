import { formatCount } from '../../shared/format'
import type { RunState } from '../lib/useRun'
import ModelChip from './ModelChip'

/** The run's readout: the model, the time from click to the last paragraph, reasoning tokens and cost. */
export default function Readout({ run }: { run: RunState }) {
  const done = run.phase === 'done'
  const dash = '—'
  return (
    <div className={`ds-strip${done ? '' : ' ds-strip--pending'}`} role="group" aria-label="Run readout">
      <div className="ds-strip__item">
        <span className="ds-strip__label">Model</span>
        <span className="ds-strip__value readout__chip">
          {done && run.modelOutcome ? <ModelChip outcome={run.modelOutcome} model={run.servedModel} marker={run.marker} /> : dash}
        </span>
      </div>
      <div className="ds-strip__item">
        <span className="ds-strip__label">Elapsed</span>
        <span className="ds-strip__value">{run.elapsedMs === null ? dash : `${(run.elapsedMs / 1000).toFixed(1)} s`}</span>
      </div>
      <div className="ds-strip__item">
        <span className="ds-strip__label">Reasoning tokens</span>
        <span className="ds-strip__value">{run.reasoningTokens === null ? dash : formatCount(run.reasoningTokens)}</span>
      </div>
      <div className="ds-strip__item">
        <span className="ds-strip__label">Cost</span>
        <span className="ds-strip__value">{!done ? dash : run.cost === null ? 'cost unknown' : `$${run.cost.toFixed(4)}`}</span>
      </div>
    </div>
  )
}
