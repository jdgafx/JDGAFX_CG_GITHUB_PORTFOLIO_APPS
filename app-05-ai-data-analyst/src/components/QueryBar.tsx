import { useEffect, useRef } from 'react'
import { MAX_QUESTION_CHARS } from '../lib/limits'
import type { ParsedData } from '../types'

interface QueryBarProps {
  parsedData: ParsedData | null
  datasetLabel: string
  question: string
  suggestions: string[]
  examplesOpen: boolean
  onExamplesToggle: (open: boolean) => void
  isLoading: boolean
  statusText: string
  onQuestionChange: (value: string) => void
  onAnalyze: () => void
  onStop: () => void
}

/** The question section: ask a new question about the loaded data and start the run. */
export default function QueryBar({
  parsedData,
  datasetLabel,
  question,
  suggestions,
  examplesOpen,
  onExamplesToggle,
  isLoading,
  statusText,
  onQuestionChange,
  onAnalyze,
  onStop,
}: QueryBarProps) {
  const stopRef = useRef<HTMLButtonElement>(null)
  // Stop takes focus when a run starts, without scrolling, so Enter or Space can stop it at once.
  useEffect(() => {
    if (isLoading) stopRef.current?.focus({ preventScroll: true })
  }, [isLoading])
  const length = Array.from(question.trim()).length
  const valid = Boolean(parsedData) && length >= 1 && length <= MAX_QUESTION_CHARS

  return (
    <>
      <section className="ds-section" aria-label="Question">
        <form
          id="question-form"
          className="ds-stack"
          onSubmit={(event) => {
            event.preventDefault()
            if (valid && !isLoading) onAnalyze()
          }}
        >
          <div className="ds-field">
            <label className="ds-label" htmlFor="question">Your question</label>
            <textarea
              id="question"
              className="ds-textarea"
              rows={3}
              value={question}
              disabled={isLoading || !parsedData}
              placeholder={suggestions[0] ? `e.g. ${suggestions[0]}` : 'Ask about a column in your data'}
              aria-describedby="question-help"
              onChange={(event) => onQuestionChange(event.target.value)}
              onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest' })}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && valid && !isLoading) {
                  event.preventDefault()
                  onAnalyze()
                }
              }}
            />
            <p id="question-help" className={length > MAX_QUESTION_CHARS ? 'ds-help ds-help--error' : 'ds-help'}>
              {parsedData ? `About ${datasetLabel}. ` : ''}
              {length.toLocaleString()} of {MAX_QUESTION_CHARS.toLocaleString()} characters
              {length > MAX_QUESTION_CHARS && `. Too long by ${(length - MAX_QUESTION_CHARS).toLocaleString()}: shorten it to run it.`}
            </p>
          </div>
        </form>
      </section>

      <div className="ds-actions">
        <button type="submit" form="question-form" className="ds-button ds-button--primary" disabled={!valid || isLoading}>
          Plan and run
        </button>
        {isLoading && (
          <button ref={stopRef} type="button" className="ds-button" onClick={onStop}>
            Stop
          </button>
        )}
      </div>

      <p className="app-status" role="status" aria-live="polite">{statusText}</p>

      {suggestions.length > 0 && (
        <details className="ds-disclosure" open={examplesOpen} onToggle={(event) => onExamplesToggle(event.currentTarget.open)}>
          <summary>Examples</summary>
          <ul className="ds-choice-list">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  className={question === suggestion ? 'ds-choice ds-choice--selected' : 'ds-choice'}
                  disabled={isLoading}
                  onClick={() => onQuestionChange(suggestion)}
                >
                  <span className="ds-choice__text">{suggestion}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}
