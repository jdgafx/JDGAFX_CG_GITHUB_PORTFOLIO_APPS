import { useRef, useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { FileText, Hash, ChevronUp, ChevronDown } from 'lucide-react'
import { VIEWER_WINDOW } from '../lib/constants'
import type { DocumentState } from '../types'

interface DocumentViewerProps {
  document: DocumentState
  highlightedChunks: number[]
}

/** Chunks kept in the DOM at once. A long PDF can produce tens of thousands of
 * chunks, and rendering them all as animated nodes locks up the tab. */
const WINDOW_SIZE = VIEWER_WINDOW * 2 + 1

export function DocumentViewer({ document, highlightedChunks }: DocumentViewerProps) {
  const chunkRefs = useRef(new Map<number, HTMLDivElement>())
  const [focusIndex, setFocusIndex] = useState(0)
  const [pendingScroll, setPendingScroll] = useState<number | null>(null)
  const [jumpValue, setJumpValue] = useState('')

  const total = document.chunks.length
  const isWindowed = total > WINDOW_SIZE
  const start = isWindowed
    ? Math.max(0, Math.min(focusIndex - VIEWER_WINDOW, total - WINDOW_SIZE))
    : 0
  const end = isWindowed ? start + WINDOW_SIZE : total

  const target = highlightedChunks[0]

  // A cited source may sit far outside the rendered window -- move the window to
  // it, then scroll once the node exists.
  useEffect(() => {
    if (target === undefined) return
    setFocusIndex(target)
    setPendingScroll(target)
  }, [target])

  useEffect(() => {
    if (pendingScroll === null) return
    const el = chunkRefs.current.get(pendingScroll)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setPendingScroll(null)
    }
  }, [pendingScroll, start, end])

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, total - 1))
      setFocusIndex(clamped)
      setPendingScroll(clamped)
    },
    [total],
  )

  const handleJump = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const raw = jumpValue.trim()
      if (raw === '') return
      const parsed = Number(raw)
      if (!Number.isFinite(parsed)) return
      // goTo clamps, so an out-of-range number lands on the nearest real chunk
      // rather than leaving the control looking broken.
      goTo(Math.round(parsed) - 1)
      setJumpValue('')
    },
    [jumpValue, goTo],
  )

  return (
    <div
      className="flex flex-col h-full min-h-0"
      style={{ borderRight: '1px solid var(--color-border)' }}
    >
      <div
        className="px-5 py-3 flex items-center justify-between gap-3 shrink-0"
        style={{
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-secondary)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={15} style={{ color: 'var(--color-accent)' }} />
          <span
            className="text-sm font-medium truncate max-w-[200px]"
            style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
            title={document.title}
          >
            {document.title}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Stat label="chunks" value={total} hint="Passages this document was split into" />
          <Stat label="pages" value={document.pages} hint="Pages found in the source document" />
          <Stat
            label="chars"
            value={document.charCount.toLocaleString()}
            hint="Characters of text extracted"
          />
        </div>
      </div>

      {isWindowed && (
        <div
          className="px-5 py-2 flex items-center justify-between gap-2 shrink-0 flex-wrap"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <span
            className="text-xs"
            style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}
            title="Only part of a long document is kept on screen at once so the page stays responsive"
          >
            chunks {start + 1}-{end} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goTo(focusIndex - WINDOW_SIZE)}
              disabled={start === 0}
              aria-label="Show earlier chunks"
              title="Show earlier chunks"
              className="w-6 h-6 rounded flex items-center justify-center"
              style={{
                color: 'var(--color-text-muted)',
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
                opacity: start === 0 ? 0.4 : 1,
                cursor: start === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              onClick={() => goTo(focusIndex + WINDOW_SIZE)}
              disabled={end >= total}
              aria-label="Show later chunks"
              title="Show later chunks"
              className="w-6 h-6 rounded flex items-center justify-center"
              style={{
                color: 'var(--color-text-muted)',
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
                opacity: end >= total ? 0.4 : 1,
                cursor: end >= total ? 'not-allowed' : 'pointer',
              }}
            >
              <ChevronDown size={12} />
            </button>
            {/* noValidate: without it the browser silently blocks submit for a
                number above `max`, and the control looks dead. */}
            <form onSubmit={handleJump} noValidate className="flex items-center gap-1">
              <label htmlFor="jump-to-chunk" className="sr-only">
                Jump to chunk number
              </label>
              <input
                id="jump-to-chunk"
                type="number"
                min={1}
                max={total}
                value={jumpValue}
                onChange={e => setJumpValue(e.target.value)}
                placeholder="go to"
                title={`Jump to a chunk number between 1 and ${total}`}
                className="w-16 px-2 py-0.5 rounded text-xs outline-none"
                style={{
                  color: 'var(--color-text-primary)',
                  background: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <button
                type="submit"
                title="Jump to that chunk"
                className="px-2 py-0.5 rounded text-xs"
                style={{
                  color: 'var(--color-accent)',
                  background: 'var(--color-accent-muted)',
                  border: '1px solid var(--color-border-accent)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                go
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-1">
        {document.chunks.slice(start, end).map((chunk, offset) => {
          const i = start + offset
          const isHighlighted = highlightedChunks.includes(i)
          const page = document.chunkPages[i]
          return (
            <motion.div
              key={i}
              ref={el => {
                if (el) chunkRefs.current.set(i, el)
                else chunkRefs.current.delete(i)
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
                  title={`Passage ${i + 1} of ${total}`}
                >
                  chunk {i + 1}
                </span>
                {page !== undefined && (
                  <span
                    className="text-xs"
                    style={{ fontFamily: 'var(--font-mono)' }}
                    title={`This passage starts on page ${page} of the document`}
                  >
                    · page {page}
                  </span>
                )}
                {isHighlighted && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-xs px-2 py-0.5 rounded-full"
                    title="The assistant used this passage in its answer"
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

function Stat({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="flex items-center gap-1" title={hint}>
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
