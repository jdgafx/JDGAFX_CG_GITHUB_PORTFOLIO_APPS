import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'

interface ZoomOverlayProps {
  src: string
  label: string
  onClose: () => void
}

export default function ZoomOverlay({ src, label, onClose }: ZoomOverlayProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<Element | null>(null)

  useEffect(() => {
    restoreRef.current = document.activeElement
    closeRef.current?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      const restore = restoreRef.current
      if (restore instanceof HTMLElement && document.contains(restore)) restore.focus()
    }
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
      aria-label={`Zoomed view of ${label}`}
      className="fixed inset-0 z-50 bg-black/92 backdrop-blur-2xl flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div className="absolute top-4 right-4">
        <button
          ref={closeRef}
          title="Close zoomed view (Esc)"
          aria-label="Close zoomed view"
          className="w-9 h-9 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] flex items-center justify-center text-gray-300 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>

      <motion.img
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        src={src}
        alt={`Zoomed view of ${label}`}
        className="max-w-full max-h-full object-contain rounded-xl"
        onClick={e => e.stopPropagation()}
      />
    </motion.div>
  )
}
