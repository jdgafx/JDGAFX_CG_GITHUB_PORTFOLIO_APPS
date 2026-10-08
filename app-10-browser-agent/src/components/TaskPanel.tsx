import { MAX_TASK_CHARS, PRESETS } from '../lib/constants'

interface TaskPanelProps {
  task: string
  busy: boolean
  onTaskChange: (task: string) => void
  onSubmit: () => void
}

/** The task to plan and run, and the example picker that fills the field. */
export default function TaskPanel({ task, busy, onTaskChange, onSubmit }: TaskPanelProps) {
  const submit = () => {
    if (task.trim() && !busy) onSubmit()
  }

  return (
    <section className="ds-section" aria-labelledby="task-heading">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="task-heading">Task</h2>
        <p className="ds-section__sub">Describe what the agent should do, or start from an example.</p>
      </div>
      <div className="ds-stack">
        <div className="ds-field">
          <div className="ds-row bb-field-head">
            <label className="ds-label" htmlFor="task-input">Describe a web task</label>
            <span className="ds-hint">{task.length} of {MAX_TASK_CHARS} characters</span>
          </div>
          <textarea
            id="task-input"
            className="ds-textarea"
            rows={3}
            maxLength={MAX_TASK_CHARS}
            value={task}
            disabled={busy}
            placeholder="For example: Open google.com and report the page title"
            aria-describedby="task-help task-keys"
            onChange={(event) => onTaskChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
          <p className="ds-help" id="task-help">What the agent should do on an allowed site, in plain words.</p>
          <p className="ds-hint" id="task-keys">Enter plans and runs the task. Shift+Enter adds a line.</p>
        </div>

        <div className="ds-field">
          <label className="ds-label" htmlFor="example-task">Example tasks</label>
          <select
            id="example-task"
            className="ds-select"
            value=""
            disabled={busy}
            aria-describedby="example-help"
            onChange={(event) => {
              if (event.target.value) onTaskChange(event.target.value)
            }}
          >
            <option value="">Choose an example to fill the box</option>
            {PRESETS.map((preset) => (
              <option key={preset} value={preset}>{preset}</option>
            ))}
          </select>
          <p className="ds-help" id="example-help">Every example names only allowed sites, so each one runs as written.</p>
        </div>
      </div>
    </section>
  )
}
