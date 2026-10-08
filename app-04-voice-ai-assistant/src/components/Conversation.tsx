import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../lib/api'

interface ConversationProps {
  messages: ChatMessage[]
  onClear: () => void
  clearDisabled: boolean
}

export default function Conversation({ messages, onClear, clearDisabled }: ConversationProps) {
  const logRef = useRef<HTMLDivElement>(null)

  // Keep the newest message in view by scrolling the log itself, not the page.
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages])

  return (
    <section className="ds-card" aria-labelledby="conversation-title">
      <div className="ds-card__head">
        <h2 id="conversation-title" className="ds-card__title">
          Conversation
        </h2>
        <button
          type="button"
          className="ds-button"
          onClick={onClear}
          disabled={clearDisabled || messages.length === 0}
        >
          Clear conversation
        </button>
      </div>
      {messages.length === 0 ? (
        <div className="ds-empty">Ask something by voice or by typing. Replies appear here.</div>
      ) : (
        <div ref={logRef} className="vox-log" role="log" aria-live="polite" aria-label="Messages">
          {messages.map(message => (
            <div key={message.id} className={`vox-message vox-message--${message.role}`}>
              <p>
                <span className="sr-only">{message.role === 'user' ? 'You said: ' : 'VoxAI replied: '}</span>
                {message.content}
              </p>
              {message.role === 'assistant' && message.model && (
                <p className="ds-hint">Answered by {message.model}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
