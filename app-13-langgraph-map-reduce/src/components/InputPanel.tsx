import { MAX_CHARS, MIN_CHARS, RANGE_MESSAGE } from '../lib/limits'
import { formatChars } from '../lib/format'

interface InputPanelProps {
  text: string
  running: boolean
  valid: boolean
  onChange: (text: string) => void
  onSample: () => void
  onRun: () => void
}

export function InputPanel({ text, running, valid, onChange, onSample, onRun }: InputPanelProps) {
  const count = text.length
  const outOfRange = count > 0 && (count < MIN_CHARS || count > MAX_CHARS)

  return (
    <section className="ds-card" aria-labelledby="input-title">
      <div className="ds-card__head">
        <h2 id="input-title" className="ds-card__title">
          Document
        </h2>
        <button type="button" className="ds-button" onClick={onSample} disabled={running}>
          Run the sample
        </button>
      </div>
      <div className="ds-field">
        <label className="ds-label" htmlFor="doc-text">
          Paste a document of 200 to 20,000 characters
        </label>
        <textarea
          id="doc-text"
          className="ds-textarea doc-input"
          value={text}
          disabled={running}
          spellCheck={false}
          aria-describedby="doc-count"
          onChange={(event) => onChange(event.target.value)}
        />
        <p id="doc-count" className={outOfRange ? 'ds-hint doc-count is-over' : 'ds-hint doc-count'}>
          {formatChars(count)} / {formatChars(MAX_CHARS)} characters{outOfRange ? `. ${RANGE_MESSAGE}` : ''}
        </p>
      </div>
      <div className="ds-row doc-actions">
        <button type="button" className="ds-button ds-button--primary" onClick={onRun} disabled={!valid || running}>
          {running ? 'Running' : 'Analyze'}
        </button>
      </div>
    </section>
  )
}
