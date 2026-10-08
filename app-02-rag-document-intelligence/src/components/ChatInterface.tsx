import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react'
import { AnswerTurn } from './AnswerTurn'
import { ErrorBanner } from './ErrorBanner'
import type { Turn } from '../types'

interface ChatInterfaceProps {
  documentReady: boolean
  turns: Turn[]
  chunkPages: number[]
  question: string
  running: boolean
  /** The step now running, shown in the status line while a question is in progress. */
  pendingStep: string | null
  /** The last run's outcome line, or null when there is nothing to report yet. */
  settledStatus: string | null
  askError: string | null
  onQuestionChange: (q: string) => void
  onAsk: () => void
  onStop: () => void
  onHighlight: (indices: number[]) => void
}

export function ChatInterface({
  documentReady,
  turns,
  chunkPages,
  question,
  running,
  pendingStep,
  settledStatus,
  askError,
  onQuestionChange,
  onAsk,
  onStop,
  onHighlight,
}: ChatInterfaceProps) {
  const conversationRef = useRef<HTMLDivElement>(null)

  // Keeps the newest answer in view. Only the conversation box scrolls, not the page.
  useEffect(() => {
    const el = conversationRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns.length])

  if (!documentReady) {
    return (
      <div className="ds-empty">
        <p className="ds-label">Upload a document to start</p>
        <p className="ds-hint">Answers come only from that document&apos;s passages.</p>
      </div>
    )
  }

  const canAsk = !running && question.trim() !== ''

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (canAsk) onAsk()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canAsk) onAsk()
    }
  }

  const status = running
    ? pendingStep
      ? `Running step: ${pendingStep}.`
      : 'Working on your question.'
    : settledStatus ?? ''

  return (
    <div className="ds-stack">
      {turns.length === 0 ? (
        <div className="ds-empty">
          <p className="ds-hint">No questions yet. Ask about a name, a date or a figure in the document.</p>
        </div>
      ) : (
        <div ref={conversationRef} className="docmind-conversation">
          {turns.map(turn => (
            <AnswerTurn key={turn.id} turn={turn} chunkPages={chunkPages} onHighlight={onHighlight} />
          ))}
        </div>
      )}

      <p className="ds-hint" role="status">
        {status}
      </p>
      <ErrorBanner message={askError} />

      <form className="ds-stack" onSubmit={handleSubmit}>
        <div className="ds-field">
          <label htmlFor="docmind-question" className="ds-label">
            Question
          </label>
          <textarea
            id="docmind-question"
            className="ds-textarea"
            rows={3}
            value={question}
            onChange={e => onQuestionChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What does the document say about…"
          />
          <p className="ds-hint">Enter sends. Shift+Enter adds a line.</p>
        </div>
        <div className="ds-row">
          <button type="submit" className="ds-button ds-button--primary" disabled={!canAsk}>
            Ask
          </button>
          {running && (
            <button type="button" className="ds-button" onClick={onStop}>
              Stop
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
