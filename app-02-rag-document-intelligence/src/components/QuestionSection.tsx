import { type FormEvent, type KeyboardEvent } from 'react'
import { ErrorBanner } from './ErrorBanner'

interface QuestionSectionProps {
  documentReady: boolean
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

/** The question field and the Ask action. Ask stays disabled until a document and a question exist. */
export function QuestionSection({
  documentReady,
  question,
  running,
  pendingStep,
  settledStatus,
  askError,
  onQuestionChange,
  onAsk,
  onStop,
}: QuestionSectionProps) {
  const canAsk = documentReady && !running && question.trim() !== ''

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (canAsk) onAsk()
  }

  // Enter asks. Shift+Enter adds a line.
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canAsk) onAsk()
    }
  }

  const status = !documentReady
    ? 'Add a document to start.'
    : running
      ? pendingStep
        ? `Asking. Running step: ${pendingStep}.`
        : 'Asking. Ranking the passages in your browser.'
      : settledStatus ?? ''

  return (
    <section className="ds-section" aria-labelledby="section-question">
      <div className="ds-section__head">
        <h2 id="section-question" className="ds-section__title">
          Question
        </h2>
        <p className="ds-section__sub">What you want to know. The answer uses only the passages that match it.</p>
      </div>

      <form className="ds-stack" onSubmit={handleSubmit}>
        <div className="ds-field">
          <label htmlFor="docmind-question" className="ds-label">
            Your question
          </label>
          <textarea
            id="docmind-question"
            className="ds-textarea"
            rows={3}
            value={question}
            disabled={!documentReady}
            aria-describedby="docmind-question-help"
            onChange={e => onQuestionChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What does the document say about…"
          />
          <p id="docmind-question-help" className="ds-help">
            Passages that share words with this question go to the model. Enter asks.
          </p>
        </div>

        <div className="ds-row">
          <button type="submit" className="ds-button ds-button--primary" disabled={!canAsk} aria-busy={running}>
            Ask
          </button>
          {running && (
            <button type="button" className="ds-button" onClick={onStop}>
              Stop
            </button>
          )}
        </div>
        <p className="ds-help">Ask ranks the passages in your browser, then has the model answer from them only.</p>
        {running && <p className="ds-help">Stop ends the wait here. The server may still finish the model call.</p>}

        <p className="ds-hint" role="status">
          {status}
        </p>
        <ErrorBanner message={askError} />
      </form>
    </section>
  )
}
