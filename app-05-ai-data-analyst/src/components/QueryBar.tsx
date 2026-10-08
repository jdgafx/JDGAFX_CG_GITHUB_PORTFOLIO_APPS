import type { ChangeEvent, RefObject } from 'react'
import type { DatasetOption, ParsedData } from '../types'

interface QueryBarProps {
  options: DatasetOption[]
  selected: string
  parsedData: ParsedData | null
  question: string
  suggestions: string[]
  isLoading: boolean
  statusText: string
  fileInputRef: RefObject<HTMLInputElement | null>
  onSelect: (value: string) => void
  onUploadClick: () => void
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onQuestionChange: (value: string) => void
  onAnalyze: () => void
  onStop: () => void
}

/** The controls column: pick the data, then ask the question. */
export default function QueryBar({
  options,
  selected,
  parsedData,
  question,
  suggestions,
  isLoading,
  statusText,
  fileInputRef,
  onSelect,
  onUploadClick,
  onFileChange,
  onQuestionChange,
  onAnalyze,
  onStop,
}: QueryBarProps) {
  const canAnalyze = Boolean(parsedData) && question.trim().length > 0 && !isLoading

  return (
    <div className="ds-controls">
      <section className="ds-section" aria-labelledby="data-title">
        <div className="ds-section__head ds-section__head--row">
          <h2 id="data-title" className="ds-section__title">Your data</h2>
          {parsedData && (
            <span className="ds-hint ds-num">
              {parsedData.rows.length.toLocaleString()} rows, {parsedData.headers.length} columns
            </span>
          )}
        </div>
        <p className="ds-section__sub">Pick a sample or upload a CSV. Your question is asked about this data.</p>

        <div className="ds-field">
          <label className="ds-label" htmlFor="dataset">Dataset</label>
          <select
            id="dataset"
            className="ds-select"
            value={selected}
            disabled={isLoading}
            aria-describedby="dataset-help"
            onChange={(event) => onSelect(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p id="dataset-help" className="ds-help">
            Three samples to try. The model only ever sees the column names and five sample rows.
          </p>
        </div>

        <div className="ds-field">
          <div className="ds-row">
            <button
              type="button"
              className="ds-button"
              disabled={isLoading}
              aria-describedby="upload-help"
              onClick={onUploadClick}
            >
              Upload CSV
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="Upload a CSV file"
            hidden
            onChange={onFileChange}
          />
          <p id="upload-help" className="ds-help">
            Your own CSV, up to 5 MB, with a header row. It is parsed in this browser.
          </p>
        </div>
      </section>

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
              placeholder="e.g. Show total revenue by product as a bar chart"
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
    </div>
  )
}
