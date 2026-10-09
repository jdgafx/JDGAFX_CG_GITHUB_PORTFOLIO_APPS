import type { ParsedData } from '../types'

interface QueryBarProps {
  parsedData: ParsedData | null
  question: string
  suggestions: string[]
  isLoading: boolean
  statusText: string
  onQuestionChange: (value: string) => void
  onAnalyze: () => void
  onStop: () => void
}

/** The question section: ask about the loaded data and start the run. */
export default function QueryBar({
  parsedData,
  question,
  suggestions,
  isLoading,
  statusText,
  onQuestionChange,
  onAnalyze,
  onStop,
}: QueryBarProps) {
  const canAnalyze = Boolean(parsedData) && question.trim().length > 0 && !isLoading

  return (
    <section className="ds-section" aria-labelledby="question-title">
      <div className="ds-section__head">
        <h2 id="question-title" className="ds-section__title">Question</h2>
      </div>
      <p className="ds-section__sub">The model writes a query plan from your question. The browser runs that plan.</p>

      <form
        className="ds-stack"
        onSubmit={(event) => {
          event.preventDefault()
          onAnalyze()
        }}
      >
        <div className="ds-field">
          <label className="ds-label" htmlFor="question">Your question</label>
          <input
            id="question"
            className="ds-input"
            type="text"
            value={question}
            disabled={isLoading || !parsedData}
            placeholder={suggestions[0] ? `e.g. ${suggestions[0]}` : 'Ask about a column in your data'}
            autoComplete="off"
            aria-describedby="question-help"
            onChange={(event) => onQuestionChange(event.target.value)}
          />
          <p id="question-help" className="ds-help">
            Ask about a column that exists in your data. If one does not, the result says so.
          </p>
        </div>

        {suggestions.length > 0 && (
          <div className="ds-field">
            <span id="samples-label" className="ds-label">Sample questions</span>
            <div className="ds-row" role="group" aria-labelledby="samples-label">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="ds-button app-chip"
                  disabled={isLoading}
                  onClick={() => onQuestionChange(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <p className="ds-help">Click one to fill in the question, then choose Plan and run.</p>
          </div>
        )}

        <div className="app-action">
          <div className="ds-row">
            <button type="submit" className="ds-button ds-button--primary" disabled={!canAnalyze}>
              Plan and run
            </button>
            {isLoading && (
              <button type="button" className="ds-button" onClick={onStop}>
                Stop
              </button>
            )}
          </div>
          <p className="ds-help">
            Sends your question, the column names and five sample rows to the model, then runs its plan on every row.
          </p>
          {isLoading && (
            <p className="ds-help">Stops waiting here. The server may still finish the call and bill its tokens.</p>
          )}
          <p className="app-status" role="status" aria-live="polite">
            {statusText}
          </p>
        </div>
      </form>
    </section>
  )
}
