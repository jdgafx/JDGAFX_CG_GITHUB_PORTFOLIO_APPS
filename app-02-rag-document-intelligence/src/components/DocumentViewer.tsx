import { useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { FileText, Hash } from 'lucide-react'
import type { DocumentState } from '../types'

interface DocumentViewerProps {
  document: DocumentState
  highlightedChunks: number[]
}

export function DocumentViewer({ document, highlightedChunks }: DocumentViewerProps) {
  const chunkRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    if (highlightedChunks.length === 0) return
    const firstIndex = highlightedChunks[0]
    if (firstIndex === undefined) return
    const el = chunkRefs.current[firstIndex]
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightedChunks])

  return (
    <div
      className="flex flex-col h-full"
      style={{ borderRight: '1px solid var(--color-border)' }}
    >
      <div
        className="px-5 py-3 flex items-center justify-between shrink-0"
        style={{
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-secondary)',
        }}
      >
        <div className="flex items-center gap-2">
          <FileText size={15} style={{ color: 'var(--color-accent)' }} />
          <span
            className="text-sm font-medium truncate max-w-[200px]"
            style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
            title={document.title}
          >
            {document.title}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Stat label="chunks" value={document.chunks.length} />
          <Stat label="pages" value={document.pages} />
          <Stat label="chars" value={document.charCount.toLocaleString()} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
        {document.chunks.map((chunk, i) => {
          const isHighlighted = highlightedChunks.includes(i)
          return (
            <motion.div
              key={i}
              ref={el => {
                chunkRefs.current[i] = el
              }}
              initial={false}
              animate={{
                backgroundColor: isHighlighted
                  ? 'rgba(0, 255, 136, 0.08)'
                  : 'transparent',
              }}
              transition={{ duration: 0.2 }}
              className="rounded-lg px-4 py-3 relative"
              style={{
                borderLeft: isHighlighted
                  ? '2px solid var(--color-accent)'
                  : '2px solid transparent',
                transition: 'border-color 0.2s ease',
              }}
            >
              <div
                className="flex items-center gap-2 mb-2"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <Hash size={10} />
                <span
                  className="text-xs"
                  style={{ fontFamily: 'var(--font-mono)', color: isHighlighted ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                >
                  chunk {i + 1}
                </span>
                {isHighlighted && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: 'var(--color-accent-dim)',
                      color: 'var(--color-accent)',
                      fontFamily: 'var(--font-mono)',
                      border: '1px solid var(--color-border-accent)',
                    }}
                  >
                    source
                  </motion.span>
                )}
              </div>
              <p
                className="text-sm leading-relaxed"
                style={{
                  color: isHighlighted
                    ? 'var(--color-text-primary)'
                    : 'var(--color-text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  lineHeight: '1.7',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {chunk}
              </p>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-1">
      <span
        className="text-xs"
        style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        {value}
      </span>
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
    </div>
  )
}
