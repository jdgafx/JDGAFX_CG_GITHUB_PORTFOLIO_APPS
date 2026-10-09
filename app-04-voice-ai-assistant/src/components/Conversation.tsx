import { useEffect, useRef, type RefObject } from 'react'
import { useWaveform } from '../hooks/useWaveform'
import type { ChatMessage } from '../lib/api'

interface ConversationProps {
  messages: ChatMessage[]
  recording: boolean
  analyserRef: RefObject<AnalyserNode | null>
}

export default function Conversation({ messages, recording, analyserRef }: ConversationProps) {
  const logRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useWaveform(canvasRef, analyserRef, recording)

  // Keep the newest message in view by scrolling the log itself, not the page.
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages])

  return (
    <section className="ds-section" aria-labelledby="conversation-title">
      <div className="ds-section__head">
        <h2 id="conversation-title" className="ds-section__title">
          Conversation
        </h2>
        <p className="ds-section__sub">
          Your questions and the replies, oldest first. Each reply names the model that wrote it.
        </p>
      </div>
      <div className="vox-stage">
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>
      <p className="ds-help">Shows the microphone level while you record.</p>
      {messages.length === 0 ? (
        <div className="ds-empty">No questions yet. Tap Start recording or type a question to begin.</div>
      ) : (
        <div ref={logRef} className="vox-log" role="log" aria-live="polite" aria-label="Messages" tabIndex={0}>
          {messages.map(message => (
            <div
              key={message.id}
              className={`vox-message vox-message--${message.role}`}
              data-unsent={message.unsent === undefined ? undefined : 'true'}
            >
              <p>
                <span className="sr-only">{message.role === 'user' ? 'You said: ' : 'VoxAI replied: '}</span>
                {message.content}
              </p>
              {message.unsent !== undefined && (
                <p className="vox-message__unsent">
                  <strong>Not sent.</strong> {message.unsent} It is not part of the next question.
                </p>
              )}
              {message.role === 'assistant' && message.model && (
                <p className="vox-message__model">
                  Answered by <span className="ds-mono">{message.model}</span>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
