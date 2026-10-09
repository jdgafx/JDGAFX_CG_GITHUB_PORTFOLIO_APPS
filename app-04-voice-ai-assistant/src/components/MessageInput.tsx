import { useRef } from 'react'

const MAX_TEXT_INPUT_LENGTH = 2000

// Examples that fill the box. `source` names the live data the question draws on.
const EXAMPLES = [
  { question: "What's the weather in Lisbon right now?", source: 'Live weather' },
  { question: 'Who was Ada Lovelace?', source: 'Wikipedia' },
  { question: 'Is it warmer in Tokyo or in Oslo today?', source: 'Live weather' },
  { question: 'How does a voice assistant turn speech into an answer?', source: 'No tools' },
] as const

interface MessageInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled: boolean
}

export default function MessageInput({ value, onChange, onSubmit, disabled }: MessageInputProps) {
  const composingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // An example fills the box and takes focus. It never sends on its own.
  const fillExample = (question: string) => {
    onChange(question)
    inputRef.current?.focus()
  }

  return (
    <section className="ds-section" aria-labelledby="type-title">
      <div className="ds-section__head">
        <h2 id="type-title" className="ds-section__title">
          Type a question
        </h2>
        <p className="ds-section__sub">Use this with no microphone, or to ask an exact question.</p>
      </div>
      <div className="ds-field">
        <label htmlFor="vox-text" className="ds-label">
          Your question
        </label>
        <input
          id="vox-text"
          ref={inputRef}
          className="ds-input"
          type="text"
          value={value}
          maxLength={MAX_TEXT_INPUT_LENGTH}
          disabled={disabled}
          autoComplete="off"
          aria-describedby="vox-text-help"
          onChange={event => onChange(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onKeyDown={event => {
            // Enter confirms an IME candidate; don't send mid-composition.
            if (event.key === 'Enter' && !composingRef.current && !event.nativeEvent.isComposing) {
              onSubmit()
            }
          }}
        />
        <p id="vox-text-help" className="ds-help">
          Type instead of speaking. Press Enter to send the question.
        </p>
      </div>
      <div className="ds-stack">
        <button
          type="button"
          className="ds-button ds-button--primary vox-send"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          aria-describedby="send-help"
        >
          Send question
        </button>
        <p id="send-help" className="ds-help">
          Sends the typed question to the chat model.
        </p>
      </div>
      <div className="vox-control">
        <p id="examples-label" className="ds-label">
          Try an example
        </p>
        <ul className="vox-examples" aria-labelledby="examples-label">
          {EXAMPLES.map(({ question, source }) => (
            <li key={question}>
              <button type="button" className="vox-example" onClick={() => fillExample(question)} disabled={disabled}>
                <span className="vox-example__question">{question}</span>
                <span className="vox-example__source">{source}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="ds-help">
          Each example fills the box. Send it when you are ready. Weather and Wikipedia questions fetch live data.
        </p>
      </div>
    </section>
  )
}
