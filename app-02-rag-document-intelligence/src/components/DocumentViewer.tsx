import { useEffect, useRef, useState, type FormEvent } from 'react'
import { VIEWER_WINDOW } from '../lib/constants'
import { PassageMap } from './PassageMap'
import type { DocumentState, RunState } from '../types'

interface DocumentViewerProps {
  document: DocumentState
  /** Passages the browser sent to the model for the latest question. */
  sent: number[]
  /** Passages the latest answer cites. */
  citedLatest: number[]
  /** Passages to mark as cited now: a hovered source, or else the latest answer's sources. */
  highlight: number[]
  latestState: RunState | null
  /** A new object asks the list to scroll to that passage. */
  reveal: { index: number } | null
}

/** Passages kept in the DOM at once. A long PDF can produce tens of thousands of
 * passages, and rendering them all locks up the tab. */
const WINDOW_SIZE = VIEWER_WINDOW * 2 + 1

/** The passage column of the hero: the map, a window of passages, and the controls that move it. */
export function DocumentViewer({ document, sent, citedLatest, highlight, latestState, reveal }: DocumentViewerProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const passageRefs = useRef(new Map<number, HTMLLIElement>())
  const [focusIndex, setFocusIndex] = useState(0)
  // A new object per request, so the scroll effect runs once for each request.
  const [scrollRequest, setScrollRequest] = useState<{ index: number } | null>(null)
  const [jumpValue, setJumpValue] = useState('')
  const [seenReveal, setSeenReveal] = useState(reveal)

  const total = document.chunks.length
  const isWindowed = total > WINDOW_SIZE
  const start = isWindowed ? Math.max(0, Math.min(focusIndex - VIEWER_WINDOW, total - WINDOW_SIZE)) : 0
  const end = isWindowed ? start + WINDOW_SIZE : total

  // A passage to reveal may sit outside the rendered window. A new reveal moves the
  // window to it and asks for a scroll. Adjusting state during render, not in an
  // effect, lets the window and the request land in one commit.
  if (reveal !== seenReveal) {
    setSeenReveal(reveal)
    if (reveal) {
      setFocusIndex(reveal.index)
      setScrollRequest({ index: reveal.index })
    }
  }

  useEffect(() => {
    if (scrollRequest === null) return
    const list = listRef.current
    const item = passageRefs.current.get(scrollRequest.index)
    if (!list || !item) return
    // Scroll the list itself. scrollIntoView would also move the page, which
    // jumps the layout every time someone hovers a source.
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
    <div className="docmind-passage-col">
      <PassageMap
        total={total}
        sent={sent}
        citedLatest={citedLatest}
        latestState={latestState}
        start={start}
        end={end}
      />

      {isWindowed && (
        <div className="docmind-nav">
          <p className="ds-help">
            Showing passages {start + 1} to {end} of {total.toLocaleString('en-US')}. Move the list one window at a time.
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
          aria-describedby="docmind-jump-help"
          onChange={e => setJumpValue(e.target.value)}
        />
        <button type="submit" className="ds-button">
          Show passage
        </button>
        <p id="docmind-jump-help" className="ds-help docmind-jump__help">
          Type a passage number to read it in the list.
        </p>
      </form>

      <ul ref={listRef} className="docmind-passages" aria-label="Document passages">
        {document.chunks.slice(start, end).map((chunk, offset) => {
          const i = start + offset
          const page = document.chunkPages[i]
          const cited = highlight.includes(i)
          const sentToModel = sent.includes(i)
          const tone = cited
            ? 'docmind-passage docmind-passage--cited'
            : sentToModel
              ? 'docmind-passage docmind-passage--sent'
              : 'docmind-passage'
          return (
            <li
              key={i}
              ref={el => {
                if (el) passageRefs.current.set(i, el)
                else passageRefs.current.delete(i)
              }}
              className={tone}
            >
              <p className="docmind-passage__meta">
                <span>
                  Passage {i + 1}
                  {page !== undefined && `, page ${page}`}
                </span>
                {cited ? (
                  <span className="ds-badge ds-badge--accent">Cited</span>
                ) : sentToModel ? (
                  <span className="ds-badge">Sent to the model</span>
                ) : null}
              </p>
              <p className="docmind-passage__text">{chunk}</p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
