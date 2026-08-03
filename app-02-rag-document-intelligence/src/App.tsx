import { useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RotateCcw, FileText, MessageSquare } from 'lucide-react'
import { UploadZone } from './components/UploadZone'
import { DocumentViewer } from './components/DocumentViewer'
import { ChatInterface } from './components/ChatInterface'
import { ErrorBanner } from './components/ErrorBanner'
import { extractText } from './lib/pdf'
import { chunkText } from './lib/chunk'
import { askQuestion } from './lib/api'
import type { DocumentState, Message } from './types'

function generateId() {
  return Math.random().toString(36).slice(2, 11)
}

type Panel = 'document' | 'chat'

export default function App() {
  const [document, setDocument] = useState<DocumentState | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [highlightedChunks, setHighlightedChunks] = useState<number[]>([])
  const [panel, setPanel] = useState<Panel>('chat')
  const requestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  /** Abandon any in-flight answer: bump the request id so a late response is
   * ignored, and abort the fetch so it stops costing anything. */
  const cancelInFlight = useCallback(() => {
    requestIdRef.current++
    abortRef.current?.abort()
    abortRef.current = null
    setIsLoading(false)
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  const handleFileSelect = useCallback(
    async (file: File) => {
      cancelInFlight()
      setError(null)
      setIsProcessing(true)
      try {
        const { text, pages } = await extractText(file)
        const { chunks, chunkPages } = chunkText(text)
        setDocument({ title: file.name, text, chunks, chunkPages, pages, charCount: text.length })
        setMessages([])
        setHighlightedChunks([])
        setQuestion('')
        setPanel('chat')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to extract text from this file.'
        setError(msg)
        console.error('Extract error:', err)
      } finally {
        setIsProcessing(false)
      }
    },
    [cancelInFlight],
  )

  const handleSubmit = useCallback(async () => {
    if (!question.trim() || !document || isLoading) return

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: question.trim(),
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMsg])
    setQuestion('')
    setIsLoading(true)

    // Track request ID to ignore stale responses from rapid submissions
    const currentRequestId = ++requestIdRef.current
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const result = await askQuestion(
        userMsg.content,
        document.chunks,
        document.title,
        controller.signal,
      )

      // Ignore response if a newer request was made while this one was in flight
      if (currentRequestId !== requestIdRef.current) return

      const aiMsg: Message =
        result.status === 'no-matches'
          ? {
              id: generateId(),
              role: 'assistant',
              content:
                'No relevant passages found. Nothing in this document matches the words in your question, so it was not sent to the AI model. Try rephrasing using terms that appear in the text.',
              timestamp: new Date(),
            }
          : {
              id: generateId(),
              role: 'assistant',
              content: result.answer,
              sourceChunks: result.sourceChunks,
              confidence: result.confidence,
              timestamp: new Date(),
            }
      setMessages(prev => [...prev, aiMsg])
    } catch (err) {
      if (currentRequestId !== requestIdRef.current) return

      const errMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content:
          err instanceof Error && err.message
            ? err.message
            : 'Something went wrong while answering. Please try again.',
        timestamp: new Date(),
        error: true,
      }
      setMessages(prev => [...prev, errMsg])
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false)
        abortRef.current = null
      }
    }
  }, [question, document, isLoading])

  const handleCancel = useCallback(() => {
    if (!isLoading) return
    cancelInFlight()
    setMessages(prev => [
      ...prev,
      {
        id: generateId(),
        role: 'assistant',
        content: 'Stopped before an answer came back.',
        timestamp: new Date(),
      },
    ])
  }, [isLoading, cancelInFlight])

  const handleReset = useCallback(() => {
    if (
      messages.length > 0 &&
      !window.confirm('Start over with a new document? This conversation will be cleared.')
    ) {
      return
    }
    cancelInFlight()
    setDocument(null)
    setMessages([])
    setHighlightedChunks([])
    setQuestion('')
    setError(null)
    setPanel('chat')
  }, [messages.length, cancelInFlight])

  return (
    <div
      className="flex flex-col h-screen"
      style={{ background: 'var(--color-bg)', fontFamily: 'var(--font-body)' }}
    >
      <header
        className="flex items-center justify-between gap-3 px-5 py-3 shrink-0"
        style={{
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-secondary)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: 'var(--color-accent-dim)',
              border: '1px solid var(--color-border-accent)',
            }}
          >
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect x="4" y="3" width="16" height="21" rx="2.5" fill="#00ff88" opacity="0.2" stroke="#00ff88" strokeWidth="1.5"/>
              <rect x="8" y="7" width="16" height="21" rx="2.5" fill="#00ff88" opacity="0.12" stroke="#00ff88" strokeWidth="1.5"/>
              <circle cx="22" cy="22" r="6.5" stroke="#00d4ff" strokeWidth="2"/>
              <line x1="27" y1="27" x2="30" y2="30" stroke="#00d4ff" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </div>
          <span
            className="font-bold tracking-tight text-glow shrink-0"
            style={{
              fontFamily: 'var(--font-display)',
              color: 'var(--color-accent)',
              fontSize: '1.1rem',
            }}
          >
            DocMind
          </span>
          <span className="text-xs hidden sm:inline shrink-0" style={{ color: 'var(--color-text-muted)' }}>RAG Document Intelligence</span>
          {document && (
            <div
              className="flex items-center gap-2 px-3 py-1 rounded-full min-w-0"
              style={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
              }}
            >
              <span className="text-xs" style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                /
              </span>
              <span
                className="text-xs max-w-[180px] truncate"
                style={{ color: 'var(--color-text-secondary)' }}
                title={document.title}
              >
                {document.title}
              </span>
            </div>
          )}
        </div>

        {document && (
          <button
            type="button"
            onClick={handleReset}
            title="Clear this document and conversation, then upload a different file"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs shrink-0 transition-all duration-150"
            style={{
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
            }}
          >
            <RotateCcw size={11} />
            New document
          </button>
        )}
      </header>

      <div className="w-full px-5 py-2 shrink-0" style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(0,255,136,0.02)' }}>
        <p className="text-xs leading-relaxed max-w-3xl" style={{ color: 'var(--color-text-muted)', margin: 0 }}>
          Drop a PDF in here, then ask it anything. The app chops the document into searchable pieces, finds the parts that matter most, and gives you a straight answer with page references and a confidence score so you know how much to trust it.
        </p>
      </div>

      <main className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {!document ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="h-full overflow-y-auto"
            >
              <UploadZone
                onFileSelect={handleFileSelect}
                onError={setError}
                isProcessing={isProcessing}
              />
              <ErrorBanner message={error} onDismiss={() => setError(null)} />
            </motion.div>
          ) : (
            <motion.div
              key="workspace"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
              className="h-full flex flex-col min-h-0"
            >
              <div
                role="tablist"
                aria-label="Workspace panels"
                className="flex md:hidden shrink-0"
                style={{ borderBottom: '1px solid var(--color-border)' }}
              >
                <PanelTab
                  active={panel === 'document'}
                  onClick={() => setPanel('document')}
                  label="Document"
                  hint="View the document split into searchable passages"
                  icon={<FileText size={12} />}
                />
                <PanelTab
                  active={panel === 'chat'}
                  onClick={() => setPanel('chat')}
                  label="Ask"
                  hint="Ask questions about the document"
                  icon={<MessageSquare size={12} />}
                />
              </div>

              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[45fr_55fr]">
                <div className={`h-full min-h-0 ${panel === 'document' ? '' : 'hidden'} md:block`}>
                  <DocumentViewer document={document} highlightedChunks={highlightedChunks} />
                </div>
                <div className={`h-full min-h-0 ${panel === 'chat' ? '' : 'hidden'} md:block`}>
                  <ChatInterface
                    messages={messages}
                    isLoading={isLoading}
                    question={question}
                    chunkPages={document.chunkPages}
                    onQuestionChange={setQuestion}
                    onSubmit={handleSubmit}
                    onCancel={handleCancel}
                    onHighlightChunks={setHighlightedChunks}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="text-center py-3 text-xs shrink-0" style={{ color: '#475569', borderTop: '1px solid var(--color-border)' }}>
        Authored by Christopher Gentile / CGDarkstardev1 / NewDawn AI
      </footer>
    </div>
  )
}

interface PanelTabProps {
  active: boolean
  onClick: () => void
  label: string
  hint: string
  icon: React.ReactNode
}

function PanelTab({ active, onClick, label, hint, icon }: PanelTabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={hint}
      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-all duration-150"
      style={{
        color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
        background: active ? 'var(--color-accent-muted)' : 'transparent',
        borderBottom: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {icon}
      {label}
    </button>
  )
}
