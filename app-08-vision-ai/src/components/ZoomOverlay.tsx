import { useEffect, useRef } from 'react'

interface ZoomOverlayProps {
  src: string
  label: string
  onClose: () => void
}

export default function ZoomOverlay({ src, label, onClose }: ZoomOverlayProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const opener = document.activeElement
    closeRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      // Close is the only focusable control here, so Tab keeps focus on it.
      if (event.key === 'Tab') {
        event.preventDefault()
        closeRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [onClose])

  return (
    <div
      className="zoom"
      role="dialog"
      aria-modal="true"
      aria-label={`Full size view of ${label}`}
      onClick={onClose}
    >
      <button ref={closeRef} type="button" className="ds-button zoom__close" onClick={onClose}>
        Close
      </button>
      <img
        src={src}
        alt={`Full size view of ${label}`}
        onClick={event => event.stopPropagation()}
      />
    </div>
  )
}
