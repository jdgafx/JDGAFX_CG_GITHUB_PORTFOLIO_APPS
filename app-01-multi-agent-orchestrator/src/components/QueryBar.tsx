import { EXAMPLE_QUERIES, MAX_QUERY_CHARS } from '../lib/agents'

interface QueryBarProps {
  query: string
  onQueryChange: (value: string) => void
  isRunning: boolean
  showExamples: boolean
  announcement: string
  pipelineError: string | null
  onDismissError: () => void
  onStart: () => void
  onStop: () => void
  onExample: (text: string) => void
}

/** The research section: the topic field, the start and stop buttons, the status line and the examples. */
export function QueryBar({
  query,
  onQueryChange,
  isRunning,
  showExamples,
  announcement,
  pipelineError,
  onDismissError,
  onStart,
  onStop,
  onExample,
}: QueryBarProps) {
  const canStart = !isRunning && query.trim().length > 0

  return (
    <section className="ds-section" aria-labelledby="research-heading">
      <div className="ds-section__head">
        <h2 id="research-heading" className="ds-section__title">
          Research
        </h2>
        <p className="ds-section__sub">Pick a question. Four model calls answer it in order.</p>
      </div>
      <form
        className="ds-stack"
        onSubmit={event => {
          event.preventDefault()
          if (canStart) onStart()
        }}
      >
        <div className="ds-field">
          <label htmlFor="research-query" className="ds-label">
            Research topic
          </label>
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
            aria-describedby="research-query-help"
          />
          <p id="research-query-help" className="ds-help">
            The question the four agents research together, up to {MAX_QUERY_CHARS} characters.
          </p>
        </div>

        <div className="ds-row">
          <button type="submit" className="ds-button ds-button--primary" disabled={!canStart}>
            Start research
          </button>
          {isRunning && (
            <button type="button" className="ds-button" onClick={onStop}>
              Stop research
            </button>
          )}
        </div>

        <p className="ds-hint app-status" role="status" aria-live="polite">
          {announcement}
        </p>

        {pipelineError && (
          <div className="ds-notice ds-notice--error app-alert" role="alert">
            <span>{pipelineError}</span>
            <button type="button" className="ds-button" onClick={onDismissError}>
              Dismiss
            </button>
          </div>
        )}

        {showExamples && (
          <div className="ds-field">
            <p id="examples-label" className="ds-label">
              Or try an example
            </p>
            <div className="example-chips" role="group" aria-labelledby="examples-label" aria-describedby="examples-help">
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
            <p id="examples-help" className="ds-help">
              Each example fills the field and starts a run at once.
            </p>
          </div>
        )}
      </form>
    </section>
  )
}
