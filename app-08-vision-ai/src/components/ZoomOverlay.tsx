import { useEffect, useRef } from 'react'

interface ZoomOverlayProps {
  src: string
  label: string
  onClose: () => void
}

// A native modal dialog: it traps focus, closes on Escape and hands focus back to the opener.
export default function ZoomOverlay({ src, label, onClose }: ZoomOverlayProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="zoom"
      aria-label={`Full size view of ${label}`}
      onClose={onClose}
      onClick={event => {
        if (event.target === event.currentTarget) dialogRef.current?.close()
      }}
    >
      <button type="button" className="ds-button zoom__close" onClick={() => dialogRef.current?.close()}>
        Close
      </button>
      <img src={src} alt={`Full size view of ${label}`} />
    </dialog>
  )
}
