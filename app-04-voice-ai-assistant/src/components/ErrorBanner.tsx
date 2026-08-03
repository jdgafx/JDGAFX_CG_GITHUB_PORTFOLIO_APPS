import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

interface ErrorBannerProps {
  message: string | null
  onDismiss: () => void
}

export default function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="w-full px-4 py-3 rounded-xl text-sm text-red-400 flex items-start justify-between gap-3"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <span>{message}</span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss this message"
            title="Dismiss this message"
            className="shrink-0 rounded-md p-0.5 cursor-pointer text-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
