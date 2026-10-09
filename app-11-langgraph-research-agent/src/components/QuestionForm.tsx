import { useState } from 'react'
import { QUESTION_MAX_CHARS, SAMPLE_QUESTIONS } from '../lib/constants'
import { count } from '../lib/format'

interface QuestionFormProps {
  question: string
  running: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  onSample: (question: string) => void
}

/** The examples start open beside the run on a wide screen and closed on a phone, where they would push the run down. */
const examplesOpenAtStart = () => window.matchMedia('(min-width: 1000px)').matches

export function QuestionForm({ question, running, onChange, onSubmit, onCancel, onSample }: QuestionFormProps) {
  const [examplesOpen, setExamplesOpen] = useState(examplesOpenAtStart)
  const length = Array.from(question.trim()).length
  const valid = length >= 1 && length <= QUESTION_MAX_CHARS

  return (
    <>
      <section className="ds-section" aria-label="Question">
        <form
          id="question-form"
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
              rows={3}
              value={question}
              placeholder="Ask a factual question"
              aria-describedby="question-count"
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && valid && !running) {
                  event.preventDefault()
                  onSubmit()
                }
              }}
            />
            <p id="question-count" className={length > QUESTION_MAX_CHARS ? 'ds-help ds-help--error' : 'ds-help'}>
              {count(length)} of {count(QUESTION_MAX_CHARS)} characters
              {length > QUESTION_MAX_CHARS &&
                `. Too long by ${count(length - QUESTION_MAX_CHARS)}: shorten it to start the research.`}
            </p>
          </div>
        </form>
      </section>

      <div className="ds-actions">
        <button
          type="submit"
          form="question-form"
          className="ds-button ds-button--primary"
          disabled={!valid || running}
        >
          Start research
        </button>
        {running && (
          <button type="button" className="ds-button" onClick={onCancel}>
            Stop
          </button>
        )}
      </div>

      <details
        className="ds-disclosure"
        open={examplesOpen}
        onToggle={(event) => setExamplesOpen(event.currentTarget.open)}
      >
        <summary>Examples</summary>
        <ul className="ds-choice-list">
          {SAMPLE_QUESTIONS.map((sample) => (
            <li key={sample.label}>
              <button
                type="button"
                className={question === sample.question ? 'ds-choice ds-choice--selected' : 'ds-choice'}
                disabled={running}
                onClick={() => onSample(sample.question)}
              >
                <span className="ds-choice__label">{sample.label}</span>
                <span className="ds-choice__text">{sample.question}</span>
                <span className="ds-choice__meta">{sample.path}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </>
  )
}
