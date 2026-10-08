import { MAX_QUESTION_CHARS, type AnalysisMode } from '../lib/api'
import { MODES } from '../lib/modes'

interface ModeChoiceProps {
  mode: AnalysisMode
  question: string
  questionError: string
  running: boolean
  onModeChange: (mode: AnalysisMode) => void
  onQuestionChange: (value: string) => void
  onRun: () => void
}

export default function ModeChoice({
  mode,
  question,
  questionError,
  running,
  onModeChange,
  onQuestionChange,
  onRun,
}: ModeChoiceProps) {
  return (
    <section className="ds-section" aria-labelledby="mode-title">
      <div className="ds-section__head">
        <h2 id="mode-title" className="ds-section__title">
          Mode
        </h2>
        <p className="ds-section__sub">What the model is asked to do with the picture.</p>
      </div>

      <div className="mode-list" role="radiogroup" aria-labelledby="mode-title">
        {MODES.map(option => {
          const selected = option.id === mode
          return (
            <label key={option.id} className={selected ? 'mode-option is-selected' : 'mode-option'}>
              <input
                type="radio"
                name="mode"
                value={option.id}
                checked={selected}
                disabled={running}
                onChange={() => onModeChange(option.id)}
              />
              <span className="mode-option__body">
                <span className="mode-option__label">{option.label}</span>
                <span className="ds-help">{option.hint}</span>
              </span>
            </label>
          )
        })}
      </div>

      {mode === 'qa' && (
        <div className="ds-field">
          <label className="ds-label" htmlFor="question">
            Your question
          </label>
          <input
            id="question"
            className="ds-input"
            type="text"
            maxLength={MAX_QUESTION_CHARS}
            value={question}
            disabled={running}
            placeholder="For example: what does the sign say?"
            aria-invalid={questionError ? true : undefined}
            aria-describedby={questionError ? 'question-help question-error' : 'question-help'}
            onChange={event => onQuestionChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onRun()
              }
            }}
          />
          <p id="question-help" className="ds-help">
            One question about the picture. Press Enter to analyze.
          </p>
          {questionError && (
            <p id="question-error" className="ds-notice ds-notice--error" role="alert">
              {questionError}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
