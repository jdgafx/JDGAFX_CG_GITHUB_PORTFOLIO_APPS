import type { ChangeEvent, RefObject } from 'react'
import type { DatasetOption, ParsedData } from '../types'

interface QueryBarProps {
  options: DatasetOption[]
  selected: string
  parsedData: ParsedData | null
  question: string
  suggestions: string[]
  isLoading: boolean
  fileInputRef: RefObject<HTMLInputElement | null>
  onSelect: (value: string) => void
  onUploadClick: () => void
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onQuestionChange: (value: string) => void
  onAnalyze: () => void
  onStop: () => void
}

export default function QueryBar({
  options,
  selected,
  parsedData,
  question,
  suggestions,
  isLoading,
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
    <section className="ds-card" aria-labelledby="ask-title">
      <div className="ds-card__head">
        <h2 id="ask-title" className="ds-card__title">Ask about your data</h2>
        {parsedData && (
          <span className="ds-badge">
            {parsedData.rows.length.toLocaleString()} rows, {parsedData.headers.length} columns
          </span>
        )}
      </div>

      <div className="app-ask">
        <div className="ds-field">
          <label className="ds-label" htmlFor="dataset">Dataset</label>
          <select
            id="dataset"
            className="ds-select"
            value={selected}
            disabled={isLoading}
            onChange={(event) => onSelect(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="ds-stack">
          <button type="button" className="ds-button" disabled={isLoading} onClick={onUploadClick}>
            Upload CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="Upload a CSV file"
            hidden
            onChange={onFileChange}
          />
        </div>
      </div>
      <p className="ds-hint">CSV only, up to 5 MB, with a header row.</p>

      <form
        className="ds-stack"
        onSubmit={(event) => {
          event.preventDefault()
          onAnalyze()
        }}
      >
        <div className="ds-field">
          <label className="ds-label" htmlFor="question">Question</label>
          <input
            id="question"
            className="ds-input"
            type="text"
            value={question}
            disabled={isLoading || !parsedData}
            placeholder="e.g. Show total revenue by product as a bar chart"
            autoComplete="off"
            onChange={(event) => onQuestionChange(event.target.value)}
          />
        </div>
        <div className="ds-row">
          <button type="submit" className="ds-button ds-button--primary" disabled={!canAnalyze}>
            Analyze
          </button>
          {isLoading && (
            <button type="button" className="ds-button" onClick={onStop}>
              Stop
            </button>
          )}
        </div>
      </form>

      {suggestions.length > 0 && (
        <div className="ds-row" role="group" aria-label="Example questions">
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
      )}

      <p className="ds-hint">
        The model writes a query plan. Your browser runs that plan on your rows, so the numbers come from your data.
      </p>
    </section>
  )
}
