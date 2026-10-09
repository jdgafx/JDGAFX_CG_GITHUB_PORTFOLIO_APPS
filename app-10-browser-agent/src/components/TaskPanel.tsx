import { useState } from 'react'
import { MAX_TASK_CHARS, PRESETS } from '../lib/constants'

interface TaskPanelProps {
  task: string
  busy: boolean
  /** Changes when a run starts on a narrow screen, which closes the example list. */
  collapseKey: number
  onTaskChange: (task: string) => void
  onSubmit: () => void
}

/** The task to plan and run, and the example tasks that fill the field. */
export default function TaskPanel({ task, busy, collapseKey, onTaskChange, onSubmit }: TaskPanelProps) {
  const [examplesOpen, setExamplesOpen] = useState(false)
  const [seenKey, setSeenKey] = useState(collapseKey)
  if (seenKey !== collapseKey) {
    setSeenKey(collapseKey)
    setExamplesOpen(false)
  }
  const submit = () => {
    if (task.trim() && !busy) onSubmit()
  }
  const left = MAX_TASK_CHARS - task.length

  return (
    <section className="ds-section" aria-labelledby="task-heading">
      <div className="ds-section__head ds-section__head--bare">
        <h2 className="ds-section__title" id="task-heading">Task</h2>
        <p className="ds-section__sub">Describe what the browser should do on an allowed site.</p>
      </div>
      <div className="ds-field">
        <label className="ds-label" htmlFor="task-input">Describe a web task</label>
        <textarea
          id="task-input"
          className="ds-textarea"
          rows={3}
          maxLength={MAX_TASK_CHARS}
          value={task}
          disabled={busy}
          placeholder="For example: Open news.ycombinator.com and report the top three story titles"
          aria-describedby="task-count task-keys"
          onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest' })}
          onChange={(event) => onTaskChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <p className={left <= 50 ? 'ds-hint ds-help--error' : 'ds-hint'} id="task-count">{task.length} of {MAX_TASK_CHARS} characters</p>
        <p className="ds-hint" id="task-keys">Enter plans and runs the task. Shift+Enter adds a line.</p>
      </div>
      <details className="ds-disclosure" open={examplesOpen} onToggle={(event) => setExamplesOpen(event.currentTarget.open)}>
        <summary>Example tasks</summary>
        <ul className="ds-choice-list">
          {PRESETS.map((preset) => (
            <li key={preset}>
              <button
                type="button"
                className={preset === task ? 'ds-choice ds-choice--selected' : 'ds-choice'}
                disabled={busy}
                onClick={() => onTaskChange(preset)}
              >
                <span className="ds-choice__text">{preset}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="ds-help">Choose one to fill the box. The first three read live pages that change, and every example names only allowed sites.</p>
      </details>
    </section>
  )
}
