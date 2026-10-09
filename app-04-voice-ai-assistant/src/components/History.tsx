import type { ChatMessage } from '../lib/api'

interface HistoryProps {
  messages: ChatMessage[]
  clearDisabled: boolean
  onClear: () => void
}

// Earlier turns, kept short: the current question and answer live in the answer panel above.
export default function History({ messages, clearDisabled, onClear }: HistoryProps) {
  if (messages.length === 0) return null
  return (
    <section className="ds-section ds-run__trace vox-history" aria-labelledby="history-title">
      <details className="ds-disclosure">
        <summary id="history-title">Conversation so far ({messages.length} {messages.length === 1 ? 'message' : 'messages'})</summary>
        <div className="vox-log" role="log" aria-label="Messages" tabIndex={0}>
          {messages.map(message => (
            <div key={message.id} className={`vox-message vox-message--${message.role}`} data-unsent={message.unsent === undefined ? undefined : 'true'}>
              <p>
                <span className="sr-only">{message.role === 'user' ? 'You said: ' : 'VoxAI replied: '}</span>
                {message.content}
              </p>
              {message.unsent !== undefined && (
                <p className="vox-message__note">
                  <strong>Not sent.</strong> {message.unsent} It is not part of the next question.
                </p>
              )}
              {message.role === 'assistant' && message.model && <p className="vox-message__note">Answered by {message.model}</p>}
            </div>
          ))}
        </div>
        <div className="vox-history__foot">
          <p className="ds-help">Clearing empties the messages and the run on this page. The next question starts fresh.</p>
          <button type="button" className="ds-button ds-button--danger" onClick={onClear} disabled={clearDisabled}>
            Clear conversation
          </button>
        </div>
      </details>
    </section>
  )
}
