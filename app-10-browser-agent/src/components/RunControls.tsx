import { Play, RotateCw, Square } from 'lucide-react'
import type { Phase } from '../lib/runState'

export interface TaskErrorView {
  title: string
  message: string
  planAgain: boolean
}

interface RunControlsProps {
  task: string
  phase: Phase
  canRunAgain: boolean
  hasRun: boolean
  error: TaskErrorView | null
  onPlan: () => void
  onStop: () => void
  onRunAgain: () => void
  onReset: () => void
}

/** Each button points at the help line under its pair, so a screen reader reads what the control does. */
const START_HELP_ID = 'run-help-start'
const REPLAY_HELP_ID = 'run-help-replay'

/** Start, stop, replay or clear a run. Stop is the only control live while the browser run is in progress. */
export default function RunControls({
  task,
  phase,
  canRunAgain,
  hasRun,
  error,
  onPlan,
  onStop,
  onRunAgain,
  onReset,
}: RunControlsProps) {
  const planning = phase === 'planning'
  const running = phase === 'running'
  const busy = planning || running

  return (
    <section className="ds-section" aria-labelledby="run-heading" aria-busy={busy}>
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="run-heading">Run</h2>
        <p className="ds-section__sub">Start a run, stop it, or replay the same plan.</p>
      </div>
      <div className="ds-stack">
        <div className="bb-actions">
          <button type="button" className="ds-button ds-button--primary" aria-describedby={START_HELP_ID} disabled={busy || !task.trim()} onClick={onPlan}>
            <Play size={14} aria-hidden="true" />
            {planning ? 'Planning…' : running ? 'Running…' : 'Plan and run'}
          </button>
          <button type="button" className="ds-button" aria-describedby={START_HELP_ID} disabled={!running} onClick={onStop}>
            <Square size={14} aria-hidden="true" />
            Stop run
          </button>
        </div>
        <p className="ds-help" id={START_HELP_ID}>Plan and run makes one model call. Stop run ends the run, and a step already running may finish first.</p>

        <div className="bb-actions">
          <button type="button" className="ds-button" aria-describedby={REPLAY_HELP_ID} disabled={busy || !canRunAgain} onClick={onRunAgain}>
            <RotateCw size={14} aria-hidden="true" />
            Run plan again
          </button>
          <button type="button" className="ds-button" aria-describedby={REPLAY_HELP_ID} disabled={busy || !hasRun} onClick={onReset}>
            Reset
          </button>
        </div>
        <p className="ds-help" id={REPLAY_HELP_ID}>Run plan again replays the same steps with no model call. Reset clears the run, not your task.</p>

        {error && (
          <div className="ds-notice ds-notice--error" role="alert">
            <strong>{error.title}</strong>
            <p>{error.message}</p>
            {error.planAgain && (
              <div className="bb-actions">
                <button type="button" className="ds-button" disabled={!task.trim()} onClick={onPlan}>
                  Plan again
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
