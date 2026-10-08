import { CONTENT_TYPES, type ContentType } from '../lib/api'

export type Notice =
  | { kind: 'failed'; label: string; message: string }
  | { kind: 'stopped'; label: string }
  | null

interface BriefProps {
  topic: string
  contentType: ContentType
  running: boolean
  statusText: string
  notice: Notice
  onTopic: (value: string) => void
  onContentType: (value: ContentType) => void
  onSubmit: () => void
  onStop: () => void
  onContinue: () => void
}

export default function Brief({
  topic, contentType, running, statusText, notice,
  onTopic, onContentType, onSubmit, onStop, onContinue,
}: BriefProps) {
  return (
    <section className="ds-card" aria-labelledby="brief-title">
      <div className="ds-card__head">
        <h2 className="ds-card__title" id="brief-title">Brief</h2>
        <p className="ds-hint">Each stage is its own short request. A stage that comes back empty or cut short is retried once.</p>
      </div>

      <form
        className="brief-form"
        onSubmit={event => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="brief-fields">
          <div className="ds-field">
            <label className="ds-label" htmlFor="topic">Topic</label>
            <input
              id="topic"
              className="ds-input"
              type="text"
              value={topic}
              maxLength={400}
              autoComplete="off"
              placeholder="For example: why unit tests matter for small teams"
              disabled={running}
              onChange={event => onTopic(event.target.value)}
            />
          </div>
          <div className="ds-field">
            <label className="ds-label" htmlFor="content-type">Content type</label>
            <select
              id="content-type"
              className="ds-select"
              value={contentType}
              disabled={running}
              onChange={event => onContentType(event.target.value as ContentType)}
            >
              {CONTENT_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="brief-actions">
          <button type="submit" className="ds-button ds-button--primary" disabled={running || !topic.trim()}>
            Generate
          </button>
          {running && (
            <button type="button" className="ds-button" onClick={onStop}>Stop</button>
          )}
        </div>
      </form>

      <p className="ds-hint status-line" aria-live="polite">{statusText}</p>

      {notice?.kind === 'failed' && (
        <div className="ds-notice ds-notice--error notice-row" role="alert">
          <span><strong>{notice.label}:</strong> {notice.message}</span>
          <button type="button" className="ds-button" disabled={running} onClick={onContinue}>Retry</button>
        </div>
      )}
      {notice?.kind === 'stopped' && (
        <div className="ds-notice notice-row">
          <span>Finished stages are kept. Resume continues at {notice.label}.</span>
          <button type="button" className="ds-button" disabled={running} onClick={onContinue}>Resume</button>
        </div>
      )}
    </section>
  )
}
