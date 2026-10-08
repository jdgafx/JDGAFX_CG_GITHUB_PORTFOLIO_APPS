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
    <section className="ds-section" aria-labelledby="brief-title">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="brief-title">Brief</h2>
        <p className="ds-section__sub">Describe the piece. The five stages then write it in order.</p>
      </div>

      <form
        className="brief-form"
        onSubmit={event => {
          event.preventDefault()
          onSubmit()
        }}
      >
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
            aria-describedby="topic-help"
            disabled={running}
            onChange={event => onTopic(event.target.value)}
          />
          <p className="ds-help" id="topic-help">What the piece is about. Every stage writes toward this topic.</p>
        </div>

        <div className="ds-field">
          <label className="ds-label" htmlFor="content-type">Content type</label>
          <select
            id="content-type"
            className="ds-select"
            value={contentType}
            aria-describedby="content-type-help"
            disabled={running}
            onChange={event => onContentType(event.target.value as ContentType)}
          >
            {CONTENT_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <p className="ds-help" id="content-type-help">Sets the voice and format. Each stage still keeps to its own word budget.</p>
        </div>

        <div className="brief-actions">
          <button
            type="submit"
            className="ds-button ds-button--primary"
            disabled={running || !topic.trim()}
            aria-describedby="run-help"
          >
            Generate the piece
          </button>
          {running && (
            <button type="button" className="ds-button" onClick={onStop}>Stop</button>
          )}
        </div>
        <p className="ds-help" id="run-help">Generate runs all five stages in order. A stopped run resumes where it stopped.</p>
      </form>

      <p className="status-line" aria-live="polite">{statusText}</p>

      {notice?.kind === 'failed' && (
        <div className="ds-notice ds-notice--error notice-row" role="alert">
          <div>
            <p><strong>{notice.label} did not finish.</strong> {notice.message}</p>
            <p className="ds-help">Retry runs {notice.label} again. Finished stages are kept.</p>
          </div>
          <button type="button" className="ds-button" disabled={running} onClick={onContinue}>
            Retry from {notice.label}
          </button>
        </div>
      )}
      {notice?.kind === 'stopped' && (
        <div className="ds-notice notice-row">
          <div>
            <p>Finished stages are kept. Resume continues at {notice.label}.</p>
          </div>
          <button type="button" className="ds-button" disabled={running} onClick={onContinue}>
            Resume from {notice.label}
          </button>
        </div>
      )}
    </section>
  )
}
