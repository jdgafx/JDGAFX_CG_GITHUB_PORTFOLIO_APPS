import { ArrowRight } from 'lucide-react'
import { EXAMPLES, MAX_QUERY_CHARS } from '../lib/agents'

interface QueryBarProps {
  query: string
  /** A research run is going. */
  running: boolean
  /** The audit of a finished report is going; Stop then ends the audit. */
  auditing: boolean
  announcement: string
  pipelineError: string | null
  onQueryChange: (value: string) => void
  onDismissError: () => void
  onStart: () => void
  onExample: (text: string) => void
}

/** The research section: the topic field with its count, the Start button, the status line and the examples. */
export function QueryBar({ query, running, auditing, announcement, pipelineError, onQueryChange, onDismissError, onStart, onExample }: QueryBarProps) {
  const length = Array.from(query.trim()).length
  const valid = length >= 1 && length <= MAX_QUERY_CHARS
  const busy = running || auditing

  return (
    <>
      <section className="ds-section" aria-label="Research">
        <form
          id="research-form"
          className="ds-stack"
          onSubmit={event => {
            event.preventDefault()
            if (valid && !busy) {
              onStart()
            }
          }}
        >
          <div className="ds-field">
            <label htmlFor="research-query" className="ds-label">
              Research topic
            </label>
            <textarea
              id="research-query"
              className="ds-textarea"
              rows={2}
              value={query}
              placeholder="What should the four agents research?"
              disabled={running}
              autoComplete="off"
              aria-describedby="research-query-count"
              onChange={event => onQueryChange(event.target.value)}
              onFocus={event => event.currentTarget.closest('.ds-field')?.scrollIntoView({ block: 'nearest' })}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && valid && !busy) {
                  event.preventDefault()
                  onStart()
                }
              }}
            />
            <p id="research-query-count" className={length > MAX_QUERY_CHARS ? 'ds-help ds-help--error' : 'ds-help'}>
              {length.toLocaleString('en-US')} of {MAX_QUERY_CHARS.toLocaleString('en-US')} characters
              {length > MAX_QUERY_CHARS ? `. Too long by ${(length - MAX_QUERY_CHARS).toLocaleString('en-US')}: shorten it to start.` : ''}
            </p>
          </div>
        </form>
      </section>

      <div className="ds-actions">
        <button type="submit" form="research-form" className="ds-button ds-button--primary" disabled={!valid || busy}>
          Start research
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>

      <p className="ds-help app-status" role="status" aria-live="polite">
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

      <div className="relay-examples" role="group" aria-labelledby="examples-label">
        <span id="examples-label" className="relay-examples__label">
          Examples:
        </span>
        <ul className="ds-choice-list">
          {EXAMPLES.map(example => (
            <li key={example.label}>
              <button
                type="button"
                className={query === example.question ? 'ds-choice ds-choice--selected' : 'ds-choice'}
                disabled={busy}
                title={example.question}
                onClick={() => onExample(example.question)}
              >
                <span className="ds-choice__label">{example.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
