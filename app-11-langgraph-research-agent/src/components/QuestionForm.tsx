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
    <section className="ds-section" aria-labelledby="question-title">
      <div className="ds-section__head">
        <h2 id="question-title" className="ds-section__title">
          Question
        </h2>
        <p className="ds-section__sub">The agent answers this from Wikipedia and shows each step it takes.</p>
      </div>
      <form
        className="ds-stack"
        onSubmit={(event) => {
          event.preventDefault()
          if (valid && !running) onSubmit()
        }}
      >
        <div className="ds-field">
          <label className="ds-label" htmlFor="question-input">
            Your question
          </label>
          <textarea
            id="question-input"
            className="ds-textarea"
            rows={4}
            maxLength={QUESTION_MAX_CHARS}
            value={question}
            aria-describedby="question-help question-count"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && valid && !running) {
                event.preventDefault()
                onSubmit()
              }
            }}
          />
          <p id="question-help" className="ds-help">
            A factual question. The agent searches Wikipedia for it and cites what it finds.
          </p>
          <p id="question-count" className="ds-help">
            {count(length)} of {count(QUESTION_MAX_CHARS)} characters
          </p>
        </div>
        <div className="ds-row">
          <button type="submit" className="ds-button ds-button--primary" disabled={!valid || running}>
            Start research
          </button>
          {running && (
            <button type="button" className="ds-button" onClick={onCancel}>
              Stop
            </button>
          )}
          <button type="button" className="ds-button" onClick={onSample} disabled={running}>
            Use sample question
          </button>
        </div>
        <p className="ds-help">
          Start research runs the agent once. Stop ends a run early. The sample fills the field with a question to try.
        </p>
      </form>
    </section>
  )
}
