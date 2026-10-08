import { useEffect, useRef } from 'react'
import type { AnalysisMode } from '../lib/api'
import { MODES } from '../lib/modes'

interface AnalysisPanelProps {
  mode: AnalysisMode
  question: string
  questionError: string
  running: boolean
  canRun: boolean
  statusText: string
  onModeChange: (mode: AnalysisMode) => void
  onQuestionChange: (value: string) => void
  onRun: () => void
  onCancel: () => void
}

export default function AnalysisPanel({
  mode,
  question,
  questionError,
  running,
  canRun,
  statusText,
  onModeChange,
  onQuestionChange,
  onRun,
  onCancel,
}: AnalysisPanelProps) {
  const runRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const wasRunning = useRef(false)

  // A disabled button drops focus, so focus moves to Cancel while a run is in
  // progress and back to Run once it ends.
  useEffect(() => {
    if (running) cancelRef.current?.focus()
    else if (wasRunning.current && document.activeElement === document.body) runRef.current?.focus()
    wasRunning.current = running
  }, [running])

  const current = MODES.find(option => option.id === mode) ?? MODES[0]

  return (
    <section className="ds-card" aria-labelledby="analysis-title">
      <div className="ds-card__head">
        <h2 id="analysis-title" className="ds-card__title">
          Analysis
        </h2>
      </div>

      <div className="ds-stack">
        <fieldset className="mode-set" disabled={running}>
          <legend className="ds-label">Mode</legend>
          <div className="ds-row">
            {MODES.map(option => (
              <button
                key={option.id}
                type="button"
                className={option.id === mode ? 'ds-button ds-button--primary' : 'ds-button'}
                aria-pressed={option.id === mode}
                onClick={() => onModeChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="ds-hint">{current.hint}</p>
        </fieldset>

        {mode === 'qa' && (
          <div className="ds-field">
            <label className="ds-label" htmlFor="question">
              Question
            </label>
            <input
              id="question"
              className="ds-input"
              type="text"
              value={question}
              disabled={running}
              placeholder="For example: what does the sign say?"
              aria-invalid={questionError ? true : undefined}
              aria-describedby={questionError ? 'question-error' : 'question-hint'}
              onChange={event => onQuestionChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onRun()
                }
              }}
            />
            {questionError ? (
              <p id="question-error" className="ds-notice ds-notice--error" role="alert">
                {questionError}
              </p>
            ) : (
              <p id="question-hint" className="ds-hint">
                Press Enter to run.
              </p>
            )}
          </div>
        )}

        <div className="ds-row">
          <button
            ref={runRef}
            type="button"
            className="ds-button ds-button--primary"
            onClick={onRun}
            disabled={running || !canRun}
          >
            {running ? 'Running' : 'Run analysis'}
          </button>
          {running && (
            <button ref={cancelRef} type="button" className="ds-button" onClick={onCancel}>
              Cancel run
            </button>
          )}
        </div>
        {!canRun && <p className="ds-hint">Choose an image first.</p>}

        <p className="run-status" role="status">
          {statusText}
        </p>
        <p className="ds-hint">
          One fixed vision model runs every analysis on the server. The model that answered is listed under the
          run trace.
        </p>
      </div>
    </section>
  )
}
