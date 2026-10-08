import { useRef } from 'react'

const MAX_TEXT_INPUT_LENGTH = 2000

interface MessageInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled: boolean
  hasMic: boolean
}

export default function MessageInput({ value, onChange, onSubmit, disabled, hasMic }: MessageInputProps) {
  const composingRef = useRef(false)

  return (
    <div className="vox-input">
      <div className="ds-field">
        <label htmlFor="vox-text" className="ds-label">
          {hasMic ? 'Or type a question' : 'Type a question'}
        </label>
        <input
          id="vox-text"
          className="ds-input"
          type="text"
          value={value}
          maxLength={MAX_TEXT_INPUT_LENGTH}
          disabled={disabled}
          autoComplete="off"
          aria-describedby="vox-text-hint"
          onChange={event => onChange(event.target.value.slice(0, MAX_TEXT_INPUT_LENGTH))}
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
        <span id="vox-text-hint" className="ds-hint">
          Press Enter to send.
        </span>
      </div>
      <button
        type="button"
        className="ds-button ds-button--primary"
        onClick={onSubmit}
        disabled={disabled || !value.trim()}
      >
        Send
      </button>
    </div>
  )
}
