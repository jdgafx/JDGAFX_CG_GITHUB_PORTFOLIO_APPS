import { CONTENT_TYPES, MAX_TOPIC_CHARS, TOPIC_TOO_LONG_MESSAGE, type ContentType } from '../../netlify/shared/contract'

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
  const topicLength = topic.trim().length
  const tooLong = topicLength > MAX_TOPIC_CHARS
  return (
    <section className="ds-section" aria-labelledby="brief-title">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="brief-title">Brief</h2>
        <p className="ds-section__sub">Describe the piece. It is looked up on Wikipedia and Hacker News first, then written in five stages.</p>
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
            autoComplete="off"
            placeholder="For example: the James Webb Space Telescope"
            aria-describedby="topic-help topic-count"
            aria-invalid={tooLong}
            disabled={running}
            onChange={event => onTopic(event.target.value)}
          />
          <p className="ds-help" id="topic-help">What the piece is about. Pick a topic Wikipedia covers, such as a technology, place, event or field; the facts come from those articles.</p>
          <p className={tooLong ? 'topic-count topic-count--over' : 'topic-count'} id="topic-count" aria-live="polite">
            <span className="ds-num">{topicLength} / {MAX_TOPIC_CHARS}</span>
            {tooLong && <span role="alert"> {TOPIC_TOO_LONG_MESSAGE} Generate is off until it fits.</span>}
          </p>
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
          <p className="ds-help" id="content-type-help">Sets the voice, format and citation style (a social thread gets short links). Each stage keeps to its own word budget.</p>
        </div>

        <div className="brief-actions">
          <button
            type="submit"
            className="ds-button ds-button--primary"
            disabled={running || !topic.trim() || tooLong}
            aria-describedby="run-help"
          >
            Generate the piece
          </button>
          {running && (
            <button type="button" className="ds-button" onClick={onStop}>Stop</button>
          )}
        </div>
        <p className="ds-help" id="run-help">Generate looks up sources, then runs the five writing stages in order. A stopped run resumes where it stopped.</p>
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
