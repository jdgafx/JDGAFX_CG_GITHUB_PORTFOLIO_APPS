import { MAX_TASK_CHARS, PRESETS } from '../lib/constants'

interface TaskPanelProps {
  task: string
  busy: boolean
  onTaskChange: (task: string) => void
  onSubmit: () => void
}

/** The task to plan and run, and the example tasks that fill the field. */
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
            placeholder="For example: Open news.ycombinator.com and report the top three story titles"
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

        <div className="ds-field" role="group" aria-labelledby="example-label" aria-describedby="example-help">
          <span className="ds-label" id="example-label">Example tasks</span>
          <ul className="bb-presets">
            {PRESETS.map((preset) => (
              <li key={preset}>
                <button type="button" className="ds-button bb-preset" disabled={busy} onClick={() => onTaskChange(preset)}>
                  {preset}
                </button>
              </li>
            ))}
          </ul>
          <p className="ds-help" id="example-help">
            Choose one to fill the box. The first three read live pages that change, and every example names only allowed sites.
          </p>
        </div>
      </div>
    </section>
  )
}
