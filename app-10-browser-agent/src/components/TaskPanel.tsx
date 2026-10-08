import { Play, RotateCw, Square } from 'lucide-react'
import { MAX_TASK_CHARS, PRESETS } from '../lib/constants'
import type { Phase } from '../lib/runState'

export interface TaskErrorView {
  title: string
  message: string
  planAgain: boolean
}

interface TaskPanelProps {
  task: string
  phase: Phase
  canRunAgain: boolean
  hasRun: boolean
  error: TaskErrorView | null
  onTaskChange: (task: string) => void
  onPlan: () => void
  onStop: () => void
  onRunAgain: () => void
  onReset: () => void
}

export default function TaskPanel({
  task,
  phase,
  canRunAgain,
  hasRun,
  error,
  onTaskChange,
  onPlan,
  onStop,
  onRunAgain,
  onReset,
}: TaskPanelProps) {
  const busy = phase === 'planning' || phase === 'running'
  const submit = () => {
    if (task.trim() && !busy) onPlan()
  }

  return (
    <section className="ds-card" aria-labelledby="task-heading" aria-busy={busy}>
      <div className="ds-card__head">
        <h2 className="ds-card__title" id="task-heading">Task</h2>
        <span className="ds-hint">{task.length} of {MAX_TASK_CHARS} characters</span>
      </div>
      <div className="ds-stack">
        <div className="ds-field">
          <label className="ds-label" htmlFor="task-input">Describe a web task</label>
          <textarea
            id="task-input"
            className="ds-textarea"
            rows={3}
            maxLength={MAX_TASK_CHARS}
            value={task}
            disabled={busy}
            placeholder="For example: Open google.com and report the page title"
            aria-describedby="task-help"
            onChange={(event) => onTaskChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
          <p className="ds-hint" id="task-help">
            Enter plans and runs the task. Shift+Enter adds a line. The browser visits only allowed sites.
          </p>
        </div>

        <div className="ds-field">
          <label className="ds-label" htmlFor="example-task">Example tasks</label>
          <select
            id="example-task"
            className="ds-select"
            value=""
            disabled={busy}
            onChange={(event) => {
              if (event.target.value) onTaskChange(event.target.value)
            }}
          >
            <option value="">Choose an example to fill the box</option>
            {PRESETS.map((preset) => (
              <option key={preset} value={preset}>{preset}</option>
            ))}
          </select>
        </div>

        <div className="bb-actions">
          {phase === 'running' ? (
            <button type="button" className="ds-button" onClick={onStop}>
              <Square size={14} aria-hidden="true" />
              Stop run
            </button>
          ) : (
            <button
              type="button"
              className="ds-button ds-button--primary"
              disabled={busy || !task.trim()}
              onClick={onPlan}
            >
              <Play size={14} aria-hidden="true" />
              {phase === 'planning' ? 'Planning…' : 'Plan and run'}
            </button>
          )}
          <button type="button" className="ds-button" disabled={busy || !canRunAgain} onClick={onRunAgain}>
            <RotateCw size={14} aria-hidden="true" />
            Run plan again
          </button>
          <button type="button" className="ds-button" disabled={busy || !hasRun} onClick={onReset}>
            Reset
          </button>
        </div>

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
