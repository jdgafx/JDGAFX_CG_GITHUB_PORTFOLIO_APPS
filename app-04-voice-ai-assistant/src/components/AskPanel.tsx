import { useRef } from 'react'
import { MAX_QUESTION_CHARS, tooLongMessage } from '../lib/history'

interface AskPanelProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled: boolean
}

export default function AskPanel({ value, onChange, onSubmit, disabled }: AskPanelProps) {
  const composingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const tooLong = tooLongMessage(value)
  const count = value.trim().length

  return (
    <section className="ds-section" aria-labelledby="type-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="type-title" className="ds-section__title">
          Type a question
        </h2>
      </div>
      <form
        id="ask-form"
        className="ds-field"
        onSubmit={event => {
          event.preventDefault()
          if (!tooLong) onSubmit()
        }}
      >
        <label htmlFor="vox-text" className="ds-label">
          Your question
        </label>
        <input
          id="vox-text"
          ref={inputRef}
          className="ds-input"
          type="text"
          value={value}
          disabled={disabled}
          autoComplete="off"
          aria-describedby={tooLong ? 'vox-text-help vox-text-count vox-text-over' : 'vox-text-help vox-text-count'}
          aria-invalid={tooLong ? true : undefined}
          onChange={event => onChange(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onKeyDown={event => {
            // Enter confirms an IME candidate; it must not send mid-composition.
            if (event.key === 'Enter' && (composingRef.current || event.nativeEvent.isComposing)) event.preventDefault()
          }}
        />
        <p id="vox-text-help" className="ds-help">
          For no microphone or an exact question. Press Enter or Ask.
        </p>
        <p id="vox-text-count" className="ds-hint ds-num">
          {count.toLocaleString('en-US')} / {MAX_QUESTION_CHARS.toLocaleString('en-US')} characters
        </p>
        {tooLong && (
          <p id="vox-text-over" className="ds-help ds-help--error" role="alert">
            {tooLong}
          </p>
        )}
      </form>
    </section>
  )
}
