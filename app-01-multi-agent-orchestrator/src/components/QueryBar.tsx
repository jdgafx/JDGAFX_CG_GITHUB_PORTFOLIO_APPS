import { useEffect, useRef, useState } from 'react'
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
  onStop: () => void
  onExample: (text: string) => void
}

/** The examples start open beside the run on a wide screen and closed on a phone, where they would push the run down. */
const examplesOpenAtStart = () => window.matchMedia('(min-width: 1000px)').matches

/** The research section: the topic field with its count, the Start and Stop dock, the status line and the examples. */
export function QueryBar({ query, running, auditing, announcement, pipelineError, onQueryChange, onDismissError, onStart, onStop, onExample }: QueryBarProps) {
  const [examplesOpen, setExamplesOpen] = useState(examplesOpenAtStart)
  const stopRef = useRef<HTMLButtonElement>(null)
  const length = Array.from(query.trim()).length
  const valid = length >= 1 && length <= MAX_QUERY_CHARS
  const busy = running || auditing

  // Focus follows the action: Stop takes focus when a run starts, without moving the page.
  useEffect(() => {
    if (running) stopRef.current?.focus({ preventScroll: true })
  }, [running])

  // On a phone the open examples list would push the report off screen, so starting a run closes it.
  const closeExamples = () => {
    if (!window.matchMedia('(min-width: 1000px)').matches) setExamplesOpen(false)
  }

  return (
    <>
      <section className="ds-section" aria-label="Research">
        <form
          id="research-form"
          className="ds-stack"
          onSubmit={event => {
            event.preventDefault()
            if (valid && !busy) {
              closeExamples()
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
              rows={3}
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
                  closeExamples()
                  onStart()
                }
              }}
            />
            <p id="research-query-count" className={length > MAX_QUERY_CHARS ? 'ds-help ds-help--error' : 'ds-help'}>
              {length.toLocaleString('en-US')} of {MAX_QUERY_CHARS.toLocaleString('en-US')} characters
              {length > MAX_QUERY_CHARS ? `. Too long by ${(length - MAX_QUERY_CHARS).toLocaleString('en-US')}: shorten it to start.` : '. Wikipedia and Hacker News are searched for it.'}
            </p>
          </div>
        </form>
      </section>

      <div className="ds-actions">
        <button type="submit" form="research-form" className="ds-button ds-button--primary" disabled={!valid || busy}>
          Start research
        </button>
        {busy && (
          <button type="button" className="ds-button" onClick={onStop} ref={stopRef}>
            {running ? 'Stop' : 'Stop audit'}
          </button>
        )}
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

      <details className="ds-disclosure" open={examplesOpen} onToggle={event => setExamplesOpen(event.currentTarget.open)}>
        <summary>Examples</summary>
        <ul className="ds-choice-list">
          {EXAMPLES.map(example => (
            <li key={example.label}>
              <button
                type="button"
                className={query === example.question ? 'ds-choice ds-choice--selected' : 'ds-choice'}
                disabled={busy}
                onClick={() => {
                  closeExamples()
                  onExample(example.question)
                }}
              >
                <span className="ds-choice__label">{example.label}</span>
                <span className="ds-choice__text">{example.question}</span>
                <span className="ds-choice__meta">{example.sources}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </>
  )
}
