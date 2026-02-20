import { useRef, useEffect, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { SendHorizontal, Bot, User, ChevronDown, AlertCircle, Loader2, MessageSquare } from 'lucide-react'
import type { Message } from '../types'

interface ChatInterfaceProps {
  messages: Message[]
  isLoading: boolean
  question: string
  onQuestionChange: (q: string) => void
  onSubmit: () => void
  onHighlightChunks: (indices: number[]) => void
}

export function ChatInterface({
  messages,
  isLoading,
  question,
  onQuestionChange,
  onSubmit,
  onHighlightChunks,
}: ChatInterfaceProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (question.trim() && !isLoading) onSubmit()
      }
    },
    [question, isLoading, onSubmit],
  )

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-5 py-3 flex items-center gap-2 shrink-0"
        style={{
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-secondary)',
        }}
      >
        <Bot size={15} style={{ color: 'var(--color-accent)' }} />
        <span
          className="text-sm font-medium"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
        >
          Ask DocMind
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="h-full flex flex-col items-center justify-center gap-3 py-16"
          >
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--color-accent-dim)', border: '1px solid var(--color-border-accent)' }}
            >
              <MessageSquare size={22} style={{ color: 'var(--color-accent)' }} />
            </div>
            <p
              className="text-sm text-center max-w-xs"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Document loaded. Ask anything about its contents and I&apos;ll find the answer.
            </p>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map(msg => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onHoverSources={onHighlightChunks}
            />
          ))}
        </AnimatePresence>

        {isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3"
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: 'var(--color-accent-dim)', border: '1px solid var(--color-border-accent)' }}
            >
              <Bot size={14} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div
              className="px-4 py-3 rounded-xl flex items-center gap-2"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
            >
              <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
              <span className="text-sm" style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                Analyzing document...
              </span>
            </div>
          </motion.div>
        )}

        <div ref={bottomRef} />
      </div>

      <div
        className="px-4 py-3 shrink-0"
        style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}
      >
        <div
          className="flex items-end gap-2 rounded-xl p-2"
          style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
        >
          <textarea
            ref={inputRef}
            value={question}
            onChange={e => onQuestionChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about the document..."
            rows={1}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
            style={{
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-body)',
              maxHeight: '120px',
              caretColor: 'var(--color-accent)',
            }}
          />
          <button
            onClick={onSubmit}
            disabled={!question.trim() || isLoading}
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-150"
            style={{
              background: question.trim() && !isLoading ? 'var(--color-accent)' : 'var(--color-bg-card-hover)',
              cursor: question.trim() && !isLoading ? 'pointer' : 'not-allowed',
            }}
          >
            <SendHorizontal
              size={14}
              style={{ color: question.trim() && !isLoading ? '#000' : 'var(--color-text-muted)' }}
            />
          </button>
        </div>
        <p className="text-xs mt-2 px-2" style={{ color: 'var(--color-text-muted)' }}>
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}

interface MessageBubbleProps {
  message: Message
  onHoverSources: (indices: number[]) => void
}

function MessageBubble({ message, onHoverSources }: MessageBubbleProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const isUser = message.role === 'user'

  const confidenceColor =
    message.confidence !== undefined
      ? message.confidence > 0.8
        ? 'var(--color-success)'
        : message.confidence > 0.5
          ? 'var(--color-warning)'
          : 'var(--color-error)'
      : undefined

  const confidenceBg =
    message.confidence !== undefined
      ? message.confidence > 0.8
        ? 'rgba(0,255,136,0.12)'
        : message.confidence > 0.5
          ? 'var(--color-warning-dim)'
          : 'var(--color-error-dim)'
      : undefined

  const confidenceLabel =
    message.confidence !== undefined
      ? message.confidence > 0.8
        ? 'High'
        : message.confidence > 0.5
          ? 'Medium'
          : 'Low'
      : undefined

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
        style={{
          background: isUser ? 'rgba(255,255,255,0.06)' : 'var(--color-accent-dim)',
          border: `1px solid ${isUser ? 'var(--color-border)' : 'var(--color-border-accent)'}`,
        }}
      >
        {isUser ? (
          <User size={13} style={{ color: 'var(--color-text-secondary)' }} />
        ) : (
          <Bot size={13} style={{ color: 'var(--color-accent)' }} />
        )}
      </div>

      <div className={`flex-1 flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        {message.error && (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-error)' }}>
            <AlertCircle size={12} />
            Error
          </div>
        )}

        <div className="relative max-w-[90%]">
          {!isUser && confidenceLabel && (
            <div
              className="absolute -top-3 right-2 px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1"
              style={{
                background: confidenceBg,
                color: confidenceColor,
                border: `1px solid ${confidenceColor}33`,
                fontFamily: 'var(--font-mono)',
                fontSize: '0.65rem',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: confidenceColor }}
              />
              {confidenceLabel} confidence
            </div>
          )}

          <div
            className="px-4 py-3 rounded-xl text-sm leading-relaxed"
            style={{
              background: isUser ? 'rgba(255,255,255,0.06)' : 'var(--color-bg-card)',
              border: `1px solid ${isUser ? 'var(--color-border)' : 'var(--color-border)'}`,
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-body)',
              lineHeight: '1.65',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              marginTop: !isUser && confidenceLabel ? '8px' : '0',
            }}
          >
            {message.content}
          </div>
        </div>

        {!isUser && message.sourceChunks && message.sourceChunks.length > 0 && (
          <button
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg transition-all duration-150"
            style={{
              color: 'var(--color-accent)',
              background: 'var(--color-accent-muted)',
              border: '1px solid var(--color-border-accent)',
              fontFamily: 'var(--font-mono)',
            }}
            onMouseEnter={() => onHoverSources(message.sourceChunks ?? [])}
            onMouseLeave={() => onHoverSources([])}
            onClick={() => setSourcesOpen(v => !v)}
          >
            <span>
              {message.sourceChunks.length} source
              {message.sourceChunks.length !== 1 ? 's' : ''} used
            </span>
            <ChevronDown
              size={11}
              style={{
                transform: sourcesOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
            />
          </button>
        )}

        <AnimatePresence>
          {sourcesOpen && message.sourceChunks && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
              onMouseEnter={() => onHoverSources(message.sourceChunks ?? [])}
              onMouseLeave={() => onHoverSources([])}
            >
              <div
                className="flex flex-wrap gap-1.5 pt-1"
                style={{ maxWidth: '90%' }}
              >
                {message.sourceChunks.map(idx => (
                  <span
                    key={idx}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{
                      background: 'var(--color-accent-dim)',
                      color: 'var(--color-accent)',
                      fontFamily: 'var(--font-mono)',
                      border: '1px solid var(--color-border-accent)',
                    }}
                  >
                    chunk {idx + 1}
                  </span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </motion.div>
  )
}
