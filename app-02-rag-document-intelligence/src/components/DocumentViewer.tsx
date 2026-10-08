import { useEffect, useRef, useState, type FormEvent } from 'react'
import { VIEWER_WINDOW } from '../lib/constants'
import type { DocumentState } from '../types'

interface DocumentViewerProps {
  document: DocumentState
  /** Passage indices to mark as cited. The first one is scrolled into view. */
  highlightedChunks: number[]
}

/** Passages kept in the DOM at once. A long PDF can produce tens of thousands of
 * passages, and rendering them all locks up the tab. */
const WINDOW_SIZE = VIEWER_WINDOW * 2 + 1

export function DocumentViewer({ document, highlightedChunks }: DocumentViewerProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const passageRefs = useRef(new Map<number, HTMLLIElement>())
  const [focusIndex, setFocusIndex] = useState(0)
  // A new object per request, so the scroll effect runs once for each request.
  const [scrollRequest, setScrollRequest] = useState<{ index: number } | null>(null)
  const [jumpValue, setJumpValue] = useState('')

  const total = document.chunks.length
  const isWindowed = total > WINDOW_SIZE
  const start = isWindowed ? Math.max(0, Math.min(focusIndex - VIEWER_WINDOW, total - WINDOW_SIZE)) : 0
  const end = isWindowed ? start + WINDOW_SIZE : total

  const target = highlightedChunks[0]
  const [seenTarget, setSeenTarget] = useState(target)

  // A cited passage may sit outside the rendered window. When the cited passage
  // changes, move the window to it and ask for a scroll. Adjusting state during
  // render, not in an effect, lets the window and the request land in one commit.
  if (target !== seenTarget) {
    setSeenTarget(target)
    if (target !== undefined) {
      setFocusIndex(target)
      setScrollRequest({ index: target })
    }
  }

  useEffect(() => {
    if (scrollRequest === null) return
    const list = listRef.current
    const item = passageRefs.current.get(scrollRequest.index)
    if (!list || !item) return
    // Scroll the list itself. scrollIntoView would also move the page, which
    // jumps the layout every time someone hovers a source in the chat.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    list.scrollTo({
      top: item.offsetTop - list.clientHeight / 2 + item.offsetHeight / 2,
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }, [scrollRequest])

  const goTo = (index: number) => {
    const clamped = Math.max(0, Math.min(index, total - 1))
    setFocusIndex(clamped)
    setScrollRequest({ index: clamped })
  }

  const handleJump = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const raw = jumpValue.trim()
    if (raw === '') return
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    // goTo clamps, so an out-of-range number lands on the nearest real passage.
    goTo(Math.round(parsed) - 1)
    setJumpValue('')
  }

  return (
    <div className="ds-stack">
      <p className="ds-hint">Cited passages are marked. Hovering a source scrolls to its first passage.</p>

      {isWindowed && (
        <div className="ds-row">
          <p className="ds-hint">
            Showing passages {start + 1} to {end} of {total.toLocaleString('en-US')}.
          </p>
          <button type="button" className="ds-button" onClick={() => goTo(focusIndex - WINDOW_SIZE)} disabled={start === 0}>
            Earlier passages
          </button>
          <button type="button" className="ds-button" onClick={() => goTo(focusIndex + WINDOW_SIZE)} disabled={end >= total}>
            Later passages
          </button>
        </div>
      )}

      {/* noValidate: without it the browser silently blocks submit for a number
          above `max`, and the control looks dead. */}
      <form className="docmind-jump" onSubmit={handleJump} noValidate>
        <label htmlFor="docmind-jump" className="ds-label">
          Go to passage
        </label>
        <input
          id="docmind-jump"
          className="ds-input"
          type="number"
          inputMode="numeric"
          min={1}
          max={total}
          value={jumpValue}
          onChange={e => setJumpValue(e.target.value)}
        />
        <button type="submit" className="ds-button">
          Go
        </button>
      </form>

      <ul ref={listRef} className="docmind-passages" aria-label="Document passages">
        {document.chunks.slice(start, end).map((chunk, offset) => {
          const i = start + offset
          const cited = highlightedChunks.includes(i)
          const page = document.chunkPages[i]
          return (
            <li
              key={i}
              ref={el => {
                if (el) passageRefs.current.set(i, el)
                else passageRefs.current.delete(i)
              }}
              className={cited ? 'docmind-passage docmind-passage--cited' : 'docmind-passage'}
            >
              <p className="ds-hint">
                Passage {i + 1}
                {page !== undefined && `, page ${page}`}
                {cited && (
                  <>
                    {' '}
                    <span className="ds-badge ds-badge--accent">Cited</span>
                  </>
                )}
              </p>
              <p className="docmind-passage__text">{chunk}</p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
