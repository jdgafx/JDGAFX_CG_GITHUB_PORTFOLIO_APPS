import { useId, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { boxFromPoints, boxStyle, keyedBox, pointerFraction, type Box } from '../lib/region'
import type { RegionEntry } from '../lib/useAnalysis'

interface RegionFrameProps {
  src: string
  alt: string
  /** The boxes already asked about, drawn solid with their tags. */
  regions: RegionEntry[]
  activeId: string | null
  /** The box being drawn or moved. Null when there is none. */
  draft: Box | null
  /** When true the picture takes a drag or the keyboard to draw a box. */
  editable: boolean
  onDraft: (box: Box | null) => void
  onStart: () => void
}

// A box this close to the top edge has no room for its tag above it, so the tag moves inside.
const TAG_ROOM = 0.07
const KEY_HELP =
  'Region picker. Press Enter to start a box. Arrow keys move it. Shift with an arrow resizes it. Enter keeps it and moves to the question. Escape clears it.'

// The annotated frame: the picture with its boxes laid over it in percent units, so a box stays on the same part of the
// picture at every display size. The same frame draws the boxes of finished questions and takes a new one.
export default function RegionFrame({ src, alt, regions, activeId, draft, editable, onDraft, onStart }: RegionFrameProps) {
  const innerRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const helpId = useId()
  const [drawing, setDrawing] = useState(false)

  const fractionAt = (event: PointerEvent) => {
    const rect = innerRef.current?.getBoundingClientRect()
    return rect ? pointerFraction(event.clientX, event.clientY, rect) : { x: 0, y: 0 }
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!editable || event.button !== 0) return
    try {
      // Capture keeps the drag going when the pointer leaves the picture; a pointer that is already gone cannot be captured.
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // The drag still works without capture while the pointer stays over the picture.
    }
    anchor.current = fractionAt(event)
    setDrawing(true)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!anchor.current) return
    const next = boxFromPoints(anchor.current, fractionAt(event))
    if (next) onDraft(next)
  }
  const endDrag = () => {
    // On a phone the question can sit below the fold once the box is drawn; bring it into view.
    if (anchor.current && draft) document.getElementById('question')?.scrollIntoView({ block: 'nearest' })
    anchor.current = null
    setDrawing(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!editable) return
    if (event.key === 'Enter') {
      event.preventDefault()
      if (!draft) onStart()
      else document.getElementById('question')?.focus()
    } else if (event.key === 'Escape' && draft) {
      event.preventDefault()
      onDraft(null)
    } else if (draft) {
      const next = keyedBox(draft, event.key, event.shiftKey)
      if (next) {
        event.preventDefault()
        onDraft(next)
      }
    }
  }

  const percent = (value: number) => Math.round(value * 100)

  return (
    <div className="ds-frame vl-frame">
      <div
        ref={innerRef}
        className={['vl-frame__inner', editable ? 'is-editable' : '', drawing ? 'is-drawing' : ''].filter(Boolean).join(' ')}
        {...(editable
          ? {
              tabIndex: 0,
              role: 'group',
              'aria-roledescription': 'region picker',
              'aria-label': `${alt}. Draw a box to ask about one part.`,
              'aria-describedby': helpId,
              onPointerDown,
              onPointerMove,
              onPointerUp: endDrag,
              onPointerCancel: endDrag,
              onKeyDown,
            }
          : {})}
      >
        <img src={src} alt={editable ? '' : alt} draggable={false} />
        {regions
          .filter(entry => entry.tag)
          .map(entry => (
            <div
              key={entry.id}
              className={`ds-box vl-box${entry.id === activeId ? ' vl-box--active' : ''}${entry.box.y < TAG_ROOM ? ' vl-box--top' : ''}`}
              style={boxStyle(entry.box)}
            >
              <span className="ds-box__tag">{entry.tag}</span>
            </div>
          ))}
        {draft && (
          <div className={`ds-box vl-box vl-box--draft${draft.y < TAG_ROOM ? ' vl-box--top' : ''}`} style={boxStyle(draft)}>
            <span className="ds-box__tag">Draft</span>
          </div>
        )}
      </div>
      {editable && (
        <p id={helpId} className="ds-sr-only" aria-live="polite">
          {draft
            ? `Box at ${percent(draft.x)} percent across and ${percent(draft.y)} percent down, ${percent(draft.w)} by ${percent(draft.h)} percent. ${KEY_HELP}`
            : KEY_HELP}
        </p>
      )}
    </div>
  )
}
