import { useRef } from 'react'
import { Send } from 'lucide-react'

export const MAX_TEXT_INPUT_LENGTH = 2000

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
    <div className="w-full flex gap-2">
      <label htmlFor="voxai-text-input" className="sr-only">
        Type a message to the assistant
      </label>
      <input
        id="voxai-text-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_TEXT_INPUT_LENGTH))}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        onKeyDown={(e) => {
          // Enter confirms an IME candidate; don't send mid-composition.
          if (e.key === 'Enter' && !composingRef.current && !e.nativeEvent.isComposing) {
            onSubmit()
          }
        }}
        placeholder={hasMic ? 'Or type a message...' : 'Type a message...'}
        disabled={disabled}
        maxLength={MAX_TEXT_INPUT_LENGTH}
        title="Type a message and press Enter to send it to the assistant"
        className="flex-1 px-4 py-3 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus:ring-2 focus:ring-violet-500/50 disabled:opacity-50"
        style={{ background: '#18181b', border: '1px solid #27272a' }}
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={!value.trim() || disabled}
        aria-label="Send message"
        title="Send this message to the assistant"
        className="px-4 py-3 rounded-xl text-sm font-medium text-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}
      >
        <Send size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
