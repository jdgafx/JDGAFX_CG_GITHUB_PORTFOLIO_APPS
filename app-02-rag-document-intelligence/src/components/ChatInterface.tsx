import { useRef, useEffect, useState, useCallback, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { SendHorizontal, Bot, User, ChevronDown, AlertCircle, Loader2, MessageSquare, Square } from 'lucide-react'
import { CONFIDENCE_HIGH, CONFIDENCE_MEDIUM } from '../lib/constants'
import type { Message } from '../types'

/** Lightweight inline markdown: bold, inline code */
function renderInline(text: string): ReactNode[] {
  // Split on **bold** and `code` patterns
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          style={{
            background: 'rgba(255,255,255,0.06)',
            padding: '1px 5px',
            borderRadius: 4,
            fontFamily: 'var(--font-mono)',
            fontSize: '0.85em',
            color: 'var(--color-accent)',
          }}
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={i}>{part}</span>
  })
}

/** Render markdown-like text: headings, lists, bold, code */
function renderMarkdown(text: string): ReactNode[] {
  return text.split('\n').map((line, i) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('### ')) {
      return <div key={i} style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-accent)', marginTop: 12, marginBottom: 4 }}>{trimmed.slice(4)}</div>
    }
    if (trimmed.startsWith('## ')) {
      return <div key={i} style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)', marginTop: 14, marginBottom: 6 }}>{trimmed.slice(3)}</div>
    }
    if (trimmed.startsWith('# ')) {
      return <div key={i} style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-text-primary)', marginTop: 14, marginBottom: 6 }}>{trimmed.slice(2)}</div>
    }
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      return (
        <div key={i} style={{ paddingLeft: 14, position: 'relative', marginBottom: 3 }}>
          <span style={{ position: 'absolute', left: 2, color: 'var(--color-accent)' }}>&#8226;</span>
          {renderInline(trimmed.slice(2))}
        </div>
      )
    }
    if (/^\d+\.\s/.test(trimmed)) {
      const num = trimmed.match(/^(\d+)\./)?.[1]
      return (
        <div key={i} style={{ paddingLeft: 18, position: 'relative', marginBottom: 3 }}>
          <span style={{ position: 'absolute', left: 0, color: 'var(--color-accent)', fontWeight: 700, fontSize: 12 }}>{num}.</span>
          {renderInline(trimmed.replace(/^\d+\.\s*/, ''))}
        </div>
      )
    }
    if (trimmed === '') return <div key={i} style={{ height: 6 }} />
    return <div key={i} style={{ marginBottom: 3 }}>{renderInline(trimmed)}</div>
  })
}

interface ChatInterfaceProps {
  messages: Message[]
  isLoading: boolean
  question: string
  /** Page number per chunk index, used to label cited sources. */
  chunkPages: number[]
  onQuestionChange: (q: string) => void
  onSubmit: () => void
  onCancel: () => void
  onHighlightChunks: (indices: number[]) => void
}

export function ChatInterface({
  messages,
  isLoading,
  question,
  chunkPages,
  onQuestionChange,
  onSubmit,
  onCancel,
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

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [question])

  const canSend = question.trim().length > 0 && !isLoading

  return (
    <div className="flex flex-col h-full min-h-0">
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

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
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
              chunkPages={chunkPages}
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
              className="px-4 py-3 rounded-xl flex items-center gap-3"
              style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
            >
              <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
              <span className="text-sm" style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                Analyzing document...
              </span>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Stop generating this answer"
                title="Stop generating this answer"
                className="flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                style={{
                  color: 'var(--color-text-secondary)',
                  background: 'var(--color-bg-card-hover)',
                  border: '1px solid var(--color-border)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <Square size={9} />
                stop
              </button>
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
          <label htmlFor="docmind-question" className="sr-only">
            Ask a question about the document
          </label>
          <textarea
            id="docmind-question"
            ref={inputRef}
            value={question}
            onChange={e => onQuestionChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about the document..."
            title="Type a question. Enter sends it, Shift+Enter adds a new line."
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
            type="button"
            onClick={onSubmit}
            disabled={!canSend}
            aria-label="Send question"
            title={
              isLoading
                ? 'Waiting for the current answer to finish'
                : question.trim()
                  ? 'Send this question (Enter)'
                  : 'Type a question first'
            }
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-150"
            style={{
              background: canSend ? 'var(--color-accent)' : 'var(--color-bg-card-hover)',
              cursor: canSend ? 'pointer' : 'not-allowed',
            }}
          >
            <SendHorizontal
              size={14}
              style={{ color: canSend ? '#000' : 'var(--color-text-muted)' }}
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
  chunkPages: number[]
  onHoverSources: (indices: number[]) => void
}

function MessageBubble({ message, chunkPages, onHoverSources }: MessageBubbleProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const isUser = message.role === 'user'
  const confidence = message.confidence

  const band =
    confidence === undefined
      ? undefined
      : confidence >= CONFIDENCE_HIGH
        ? { label: 'High', color: 'var(--color-success)', bg: 'rgba(0,255,136,0.12)' }
        : confidence >= CONFIDENCE_MEDIUM
          ? { label: 'Medium', color: 'var(--color-warning)', bg: 'var(--color-warning-dim)' }
          : { label: 'Low', color: 'var(--color-error)', bg: 'var(--color-error-dim)' }

  const percent = confidence === undefined ? '' : `${Math.round(confidence * 100)}%`

  const sourceCount = message.sourceChunks?.length ?? 0

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
          {!isUser && band && (
            <div
              className="absolute -top-3 right-2 px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1"
              title={`The assistant rated its own certainty at ${percent}, based on how directly the retrieved passages answer your question`}
              style={{
                background: band.bg,
                color: band.color,
                border: `1px solid ${band.color}33`,
                fontFamily: 'var(--font-mono)',
                fontSize: '0.65rem',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: band.color }}
              />
              {band.label} confidence · {percent}
            </div>
          )}

          <div
            className="px-4 py-3 rounded-xl text-sm leading-relaxed"
            style={{
              background: isUser ? 'rgba(255,255,255,0.06)' : 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-body)',
              lineHeight: '1.65',
              whiteSpace: isUser ? 'pre-wrap' : undefined,
              wordBreak: 'break-word',
              marginTop: !isUser && band ? '8px' : '0',
            }}
          >
            {isUser ? message.content : renderMarkdown(message.content)}
          </div>
        </div>

        {!isUser && message.sourceChunks && sourceCount > 0 && (
          <button
            type="button"
            aria-expanded={sourcesOpen}
            title="Show which passages this answer came from. Hover to highlight them in the document."
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg transition-all duration-150"
            style={{
              color: 'var(--color-accent)',
              background: 'var(--color-accent-muted)',
              border: '1px solid var(--color-border-accent)',
              fontFamily: 'var(--font-mono)',
            }}
            onMouseEnter={() => onHoverSources(message.sourceChunks ?? [])}
            onMouseLeave={() => onHoverSources([])}
            onFocus={() => onHoverSources(message.sourceChunks ?? [])}
            onBlur={() => onHoverSources([])}
            onClick={() => setSourcesOpen(v => !v)}
          >
            <span>
              {sourceCount} source{sourceCount !== 1 ? 's' : ''} used
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
                {message.sourceChunks.map(idx => {
                  const page = chunkPages[idx]
                  return (
                    <span
                      key={idx}
                      className="text-xs px-2 py-0.5 rounded"
                      title={
                        page === undefined
                          ? `Passage ${idx + 1} of the document`
                          : `Passage ${idx + 1}, starting on page ${page}`
                      }
                      style={{
                        background: 'var(--color-accent-dim)',
                        color: 'var(--color-accent)',
                        fontFamily: 'var(--font-mono)',
                        border: '1px solid var(--color-border-accent)',
                      }}
                    >
                      chunk {idx + 1}
                      {page !== undefined && ` · p.${page}`}
                    </span>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <span
          className="text-xs"
          style={{ color: 'var(--color-text-muted)' }}
          title={message.timestamp.toLocaleString()}
        >
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </motion.div>
  )
}
