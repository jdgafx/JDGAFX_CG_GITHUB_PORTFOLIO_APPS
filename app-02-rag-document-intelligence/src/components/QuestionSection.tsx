import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { QUESTION_MAX_CHARS } from '../lib/constants'
import { count } from '../lib/format'
import { questionStarters } from '../lib/location'
import type { DocumentState } from '../types'
import { ErrorBanner } from './ErrorBanner'

interface QuestionSectionProps {
  doc: DocumentState | null
  question: string
  running: boolean
  /** The step now running, named in the status line while a question is in progress. */
  pendingStep: string | null
  /** The last run's outcome line, or null when there is nothing to report yet. */
  settledStatus: string | null
  askError: string | null
  onQuestionChange: (q: string) => void
  onAsk: () => void
  onStop: () => void
}

const WIDE = '(min-width: 1000px)'

/** The question field, then the Ask dock, then starters built from the document's own section titles. */
export function QuestionSection({
  doc,
  question,
  running,
  pendingStep,
  settledStatus,
  askError,
  onQuestionChange,
  onAsk,
  onStop,
}: QuestionSectionProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stopRef = useRef<HTMLButtonElement>(null)
  const [startersOpen, setStartersOpen] = useState(() => window.matchMedia(WIDE).matches)
  const starters = useMemo(() => questionStarters(doc?.sectionTitles ?? []), [doc])
  const length = Array.from(question.trim()).length
  const tooLong = length > QUESTION_MAX_CHARS
  const canAsk = doc !== null && !running && length > 0 && !tooLong

  // Focus follows the action: Stop takes focus when a run starts, without moving the page.
  useEffect(() => {
    if (running) stopRef.current?.focus({ preventScroll: true })
  }, [running])

  // On a phone the open list would push the answer off screen, so asking closes it.
  const ask = () => {
    if (!canAsk) return
    if (!window.matchMedia(WIDE).matches) setStartersOpen(false)
    onAsk()
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    ask()
  }

  // Enter asks. Shift+Enter adds a line.
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      ask()
    }
  }

  const status = !doc
    ? 'Add a document to start.'
    : running
      ? pendingStep
        ? `Asking. Running step: ${pendingStep}.`
        : 'Asking. Ranking the passages in your browser.'
      : (settledStatus ?? '')

  return (
    <>
      <section className="ds-section" aria-label="Question">
        <form id="ask-form" className="ds-stack" onSubmit={handleSubmit}>
          <div className="ds-field">
            <label htmlFor="docmind-question" className="ds-label">
              Your question
            </label>
            <textarea
              ref={inputRef}
              id="docmind-question"
              className="ds-textarea"
              rows={3}
              value={question}
              disabled={!doc}
              aria-describedby="docmind-question-count"
              onChange={e => onQuestionChange(e.target.value)}
              onFocus={e => e.currentTarget.closest('.ds-field')?.scrollIntoView({ block: 'nearest' })}
              onKeyDown={handleKeyDown}
              placeholder="What does the document say about…"
            />
            <p id="docmind-question-count" className={tooLong ? 'ds-help ds-help--error' : 'ds-help'}>
              {count(length)} of {count(QUESTION_MAX_CHARS)} characters
              {tooLong && `. Too long by ${count(length - QUESTION_MAX_CHARS)}: shorten it to ask.`}
            </p>
          </div>
        </form>
      </section>

      <div className="ds-actions">
        <button type="submit" form="ask-form" className="ds-button ds-button--primary" disabled={!canAsk} aria-busy={running}>
          Ask
        </button>
        {running && (
          <button type="button" className="ds-button" onClick={onStop} ref={stopRef}>
            Stop
          </button>
        )}
      </div>

      {starters.length > 0 && (
        <details className="ds-disclosure" open={startersOpen} onToggle={e => setStartersOpen(e.currentTarget.open)}>
          <summary>Question starters</summary>
          <ul className="ds-choice-list" aria-label="Question starters from this document">
            {starters.map(starter => (
              <li key={starter}>
                <button
                  type="button"
                  className={question === starter ? 'ds-choice ds-choice--selected' : 'ds-choice'}
                  disabled={running}
                  onClick={() => {
                    onQuestionChange(starter)
                    inputRef.current?.focus()
                  }}
                >
                  <span className="ds-choice__label">{starter}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="ds-help" role="status">
        {status}
      </p>
      <ErrorBanner message={askError} />
    </>
  )
}
