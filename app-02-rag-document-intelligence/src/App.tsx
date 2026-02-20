import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, X, RotateCcw } from 'lucide-react'
import { UploadZone } from './components/UploadZone'
import { DocumentViewer } from './components/DocumentViewer'
import { ChatInterface } from './components/ChatInterface'
import { extractText, chunkText } from './lib/pdf'
import { askQuestion } from './lib/api'
import type { DocumentState, Message } from './types'

function generateId() {
  return Math.random().toString(36).slice(2, 11)
}

export default function App() {
  const [document, setDocument] = useState<DocumentState | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [question, setQuestion] = useState('')
  const [highlightedChunks, setHighlightedChunks] = useState<number[]>([])

  const handleFileSelect = useCallback(async (file: File) => {
    setIsProcessing(true)
    try {
      const { text, pages } = await extractText(file)
      const chunks = chunkText(text, 500)
      setDocument({
        title: file.name,
        text,
        chunks,
        pages,
        charCount: text.length,
      })
      setMessages([])
      setHighlightedChunks([])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to extract text'
      console.error('Extract error:', msg)
    } finally {
      setIsProcessing(false)
    }
  }, [])

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

    try {
      const result = await askQuestion(userMsg.content, document.chunks, document.title)
      const aiMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: result.answer,
        sourceChunks: result.source_chunk_indices,
        confidence: result.confidence,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, aiMsg])
    } catch (err) {
      const errMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: err instanceof Error ? err.message : 'An error occurred. Please try again.',
        timestamp: new Date(),
        error: true,
      }
      setMessages(prev => [...prev, errMsg])
    } finally {
      setIsLoading(false)
    }
  }, [question, document, isLoading])

  const handleReset = useCallback(() => {
    setDocument(null)
    setMessages([])
    setHighlightedChunks([])
    setQuestion('')
  }, [])

  return (
    <div
      className="flex flex-col h-screen"
      style={{ background: 'var(--color-bg)', fontFamily: 'var(--font-body)' }}
    >
      <header
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-secondary)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{
              background: 'var(--color-accent-dim)',
              border: '1px solid var(--color-border-accent)',
            }}
          >
            <FileText size={14} style={{ color: 'var(--color-accent)' }} />
          </div>
          <span
            className="font-bold tracking-tight text-glow"
            style={{
              fontFamily: 'var(--font-display)',
              color: 'var(--color-accent)',
              fontSize: '1.1rem',
            }}
          >
            DocMind
          </span>
          <span className="text-xs hidden sm:inline" style={{ color: 'var(--color-text-muted)' }}>RAG Document Intelligence</span>
          {document && (
            <div
              className="flex items-center gap-2 px-3 py-1 rounded-full"
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
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all duration-150"
              style={{
                color: 'var(--color-text-muted)',
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
              }}
            >
              <RotateCcw size={11} />
              New document
            </button>
            <button
              onClick={handleReset}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150"
              style={{
                color: 'var(--color-text-muted)',
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
              }}
            >
              <X size={13} />
            </button>
          </div>
        )}
      </header>
      <div className="w-full px-5 py-2 shrink-0" style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(0,255,136,0.02)' }}>
        <p className="text-xs leading-relaxed max-w-3xl" style={{ color: 'var(--color-text-muted)', margin: 0 }}>
          Upload any PDF document and ask questions about it in plain English. DocMind parses the file client-side, splits it into searchable chunks, then sends your question plus the most relevant passages to Claude AI for an accurate, context-grounded answer. Every response includes source chunk indices and a confidence score so you can verify the answer against the original document.
        </p>
      </div>

      <main className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {!document ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              <UploadZone onFileSelect={handleFileSelect} isProcessing={isProcessing} />
            </motion.div>
          ) : (
            <motion.div
              key="workspace"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
              className="h-full grid"
              style={{ gridTemplateColumns: '45% 55%' }}
            >
              <DocumentViewer document={document} highlightedChunks={highlightedChunks} />
              <ChatInterface
                messages={messages}
                isLoading={isLoading}
                question={question}
                onQuestionChange={setQuestion}
                onSubmit={handleSubmit}
                onHighlightChunks={setHighlightedChunks}
              />
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
