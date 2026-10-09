import { useEffect, useRef } from 'react'
import { formatTokens } from '../lib/format'
import { MAX_CHARS, MIN_CHARS, RANGE_MESSAGE } from '../lib/limits'
import type { WikiFetch } from '../lib/liveData'
import { WikipediaLoader } from './WikipediaLoader'

interface InputPanelProps {
  text: string
  running: boolean
  valid: boolean
  onChange: (text: string) => void
  onFetch: (fetched: WikiFetch) => void
  onRun: () => void
  onStop: () => void
  collapseKey: number
}

export function InputPanel({ text, running, valid, onChange, onFetch, onRun, onStop, collapseKey }: InputPanelProps) {
  // Stop takes focus when it appears, without scrolling the page.
  const stopRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (running) stopRef.current?.focus({ preventScroll: true })
  }, [running])
  const count = text.length
  const outOfRange = count > 0 && (count < MIN_CHARS || count > MAX_CHARS)

  return (
    <>
    <section className="ds-section" aria-labelledby="doc-title">
      <div className="ds-section__head">
        <h2 id="doc-title" className="ds-section__title">
          Document
        </h2>
        <p className="ds-section__sub">The graph splits this text into chunks, then reads every chunk in parallel.</p>
      </div>

      <WikipediaLoader text={text} disabled={running} onLoad={onChange} onFetch={onFetch} collapseKey={collapseKey} />

      <div className="ds-field">
        <label className="ds-label" htmlFor="doc-text">
          Document text
        </label>
        <textarea
          id="doc-text"
          className="ds-textarea doc-input"
          value={text}
          disabled={running}
          spellCheck={false}
          placeholder="Or paste an article, a report or any other long text."
          aria-describedby="doc-help doc-count"
          onChange={(event) => onChange(event.target.value)}
        />
        <p id="doc-help" className="ds-help">
          Fill it from Wikipedia above or paste your own: 200 to 20,000 characters. Long texts get larger chunks, at most 12.
        </p>
        <p id="doc-count" className={outOfRange ? 'ds-hint ds-num doc-count is-over' : 'ds-hint ds-num doc-count'}>
          {formatTokens(count)} / {formatTokens(MAX_CHARS)} characters{outOfRange ? `. ${RANGE_MESSAGE}` : ''}
        </p>
      </div>
    </section>

      <div className="ds-actions">
        <button
          type="button"
          className="ds-button ds-button--primary"
          onClick={onRun}
          disabled={!valid || running}
          aria-busy={running}
         
          title="Splits the text, extracts every chunk, and writes a summary whose points cite their chunks."
        >
          {running ? 'Analyzing' : 'Analyze document'}
        </button>
        {running ? (
          <button type="button" className="ds-button" ref={stopRef} onClick={onStop} title="Stops the run in this tab. Finished steps stay in the trace.">
            Stop the run
          </button>
        ) : null}
      </div>
    </>
  )
}
