import { EXAMPLE_QUERIES, MAX_QUERY_CHARS } from '../lib/agents'

interface QueryBarProps {
  query: string
  onQueryChange: (value: string) => void
  isRunning: boolean
  showExamples: boolean
  onStart: () => void
  onStop: () => void
  onExample: (text: string) => void
}

export function QueryBar({ query, onQueryChange, isRunning, showExamples, onStart, onStop, onExample }: QueryBarProps) {
  const canStart = !isRunning && query.trim().length > 0

  return (
    <section className="ds-card" aria-label="Research topic">
      <form
        className="ds-stack"
        onSubmit={event => {
          event.preventDefault()
          if (canStart) onStart()
        }}
      >
        <div className="ds-card__head">
          <label htmlFor="research-query" className="ds-card__title">
            Research topic
          </label>
          <span className="ds-hint">Up to {MAX_QUERY_CHARS} characters</span>
        </div>
        <input
          id="research-query"
          className="ds-input"
          type="text"
          value={query}
          onChange={event => onQueryChange(event.target.value.slice(0, MAX_QUERY_CHARS))}
          placeholder="What should the four agents research?"
          disabled={isRunning}
          maxLength={MAX_QUERY_CHARS}
          autoComplete="off"
        />
        <div className="ds-row">
          <button type="submit" className="ds-button ds-button--primary" disabled={!canStart}>
            Start research
          </button>
          {isRunning && (
            <button type="button" className="ds-button" onClick={onStop}>
              Stop
            </button>
          )}
        </div>
        {showExamples && (
          <div className="ds-stack">
            <p className="ds-hint">Or try one of these:</p>
            <div className="example-chips">
              {EXAMPLE_QUERIES.map(example => (
                <button
                  key={example}
                  type="button"
                  className="example-chip"
                  disabled={isRunning}
                  onClick={() => onExample(example)}
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </section>
  )
}
