import { QUESTION_MAX_CHARS } from '../lib/constants'
import { count } from '../lib/format'

interface QuestionFormProps {
  question: string
  running: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  onSample: () => void
}

export function QuestionForm({ question, running, onChange, onSubmit, onCancel, onSample }: QuestionFormProps) {
  const length = Array.from(question.trim()).length
  const valid = length >= 1 && length <= QUESTION_MAX_CHARS

  return (
    <section className="ds-card" aria-labelledby="question-title">
      <div className="ds-card__head">
        <h2 id="question-title" className="ds-card__title">Question</h2>
        <span className="ds-hint">1 to {count(QUESTION_MAX_CHARS)} characters</span>
      </div>
      <form
        className="ds-stack"
        onSubmit={(event) => {
          event.preventDefault()
          if (valid && !running) onSubmit()
        }}
      >
        <div className="ds-field">
          <label className="ds-label" htmlFor="question-input">Your question</label>
          <textarea
            id="question-input"
            className="ds-textarea"
            rows={3}
            maxLength={QUESTION_MAX_CHARS}
            value={question}
            aria-describedby="question-count"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && valid && !running) {
                event.preventDefault()
                onSubmit()
              }
            }}
          />
          <span id="question-count" className="ds-hint">
            {count(length)} of {count(QUESTION_MAX_CHARS)} characters
          </span>
        </div>
        <div className="ds-row">
          <button type="submit" className="ds-button ds-button--primary" disabled={!valid || running}>
            Run research
          </button>
          {running && (
            <button type="button" className="ds-button" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="button" className="ds-button" onClick={onSample} disabled={running}>
            Use sample question
          </button>
        </div>
      </form>
    </section>
  )
}
