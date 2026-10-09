import { useEffect, useRef, useState } from 'react'
import { CONTENT_TYPES, MAX_TOPIC_CHARS, TOPIC_TOO_LONG_MESSAGE, type ContentType } from '../../netlify/shared/contract'

export const EXAMPLES: ReadonlyArray<{ label: string; topic: string; type: ContentType; note: string }> = [
  { label: 'Memory safety', topic: 'The Rust programming language and memory safety', type: 'Technical Article', note: 'Wikipedia and Hacker News both cover it' },
  { label: 'A telescope', topic: 'The James Webb Space Telescope', type: 'Newsletter', note: 'Wikipedia; stories from Hacker News' },
  { label: 'Apollo 11', topic: 'The Apollo 11 Moon landing', type: 'Social Thread', note: 'Short links to the sources' },
]

const WIDE = '(min-width: 1000px)'
const examplesOpenAtStart = () => window.matchMedia(WIDE).matches

interface BriefProps {
  topic: string
  contentType: ContentType
  running: boolean
  statusText: string
  resume: { label: string } | null
  onTopic: (value: string) => void
  onContentType: (value: ContentType) => void
  onSubmit: () => void
  onStop: () => void
  onContinue: () => void
}

export default function Brief({ topic, contentType, running, statusText, resume, onTopic, onContentType, onSubmit, onStop, onContinue }: BriefProps) {
  const [examplesOpen, setExamplesOpen] = useState(examplesOpenAtStart)
  const stopRef = useRef<HTMLButtonElement>(null)
  const topicLength = topic.trim().length
  const tooLong = topicLength > MAX_TOPIC_CHARS
  const valid = topicLength > 0 && !tooLong

  // Focus follows the action: Stop takes focus when a run starts, without moving the page.
  useEffect(() => {
    if (running) stopRef.current?.focus({ preventScroll: true })
  }, [running])

  // On a phone the open example list would push the piece off screen, so a run closes it.
  const start = (resuming: boolean) => {
    if (!window.matchMedia(WIDE).matches) setExamplesOpen(false)
    if (resuming) onContinue()
    else onSubmit()
  }

  return (
    <>
      <section className="ds-section" aria-label="Brief">
        <form
          id="brief-form"
          className="ds-stack"
          onSubmit={event => {
            event.preventDefault()
            if (valid && !running) start(false)
          }}
        >
          <div className="ds-field">
            <label className="ds-label" htmlFor="topic">Topic</label>
            <textarea
              id="topic"
              className="ds-textarea"
              rows={3}
              value={topic}
              placeholder="For example: the James Webb Space Telescope"
              aria-describedby="topic-count"
              aria-invalid={tooLong}
              disabled={running}
              onChange={event => onTopic(event.target.value)}
              onFocus={event => event.currentTarget.closest('.ds-field')?.scrollIntoView({ block: 'nearest' })}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && valid && !running) {
                  event.preventDefault()
                  start(false)
                }
              }}
            />
            <p id="topic-count" className={tooLong ? 'ds-help ds-help--error' : 'ds-help'}>
              {topicLength} of {MAX_TOPIC_CHARS} characters
              {tooLong && `. ${TOPIC_TOO_LONG_MESSAGE} Generate is off until it fits.`}
            </p>
          </div>

          <div className="ds-field">
            <label className="ds-label" htmlFor="content-type">Content type</label>
            <select id="content-type" className="ds-select" value={contentType} disabled={running} onChange={event => onContentType(event.target.value as ContentType)}>
              {CONTENT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
        </form>
      </section>

      <div className="ds-actions">
        <button type="submit" form="brief-form" className="ds-button ds-button--primary" disabled={!valid || running}>Generate the piece</button>
        {running && <button type="button" className="ds-button" onClick={onStop} ref={stopRef}>Stop</button>}
        {!running && resume && <button type="button" className="ds-button" onClick={() => start(true)}>{resume.label}</button>}
      </div>

      <p className="ds-help" role="status" aria-live="polite">{statusText}</p>

      <details className="ds-disclosure" open={examplesOpen} onToggle={event => setExamplesOpen(event.currentTarget.open)}>
        <summary>Examples</summary>
        <ul className="ds-choice-list">
          {EXAMPLES.map(example => (
            <li key={example.label}>
              <button
                type="button"
                className={topic === example.topic && contentType === example.type ? 'ds-choice ds-choice--selected' : 'ds-choice'}
                disabled={running}
                onClick={() => { onTopic(example.topic); onContentType(example.type) }}
              >
                <span className="ds-choice__label">{example.label}, {example.type.toLowerCase()}</span>
                <span className="ds-choice__text">{example.topic}</span>
                <span className="ds-choice__meta">{example.note}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </>
  )
}
