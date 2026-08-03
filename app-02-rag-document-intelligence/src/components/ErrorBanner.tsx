import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, X } from 'lucide-react'

interface ErrorBannerProps {
  message: string | null
  onDismiss: () => void
}

/** The one place upload, extraction and validation problems are shown, so a
 * second failure can never appear in a different corner of the screen. */
export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key="error"
          role="alert"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          className="mx-auto mt-4 max-w-md px-4 py-3 rounded-lg text-sm flex items-start gap-2"
          style={{
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#ef4444',
          }}
        >
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1">{message}</span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss this message"
            title="Dismiss this message"
            className="shrink-0 rounded p-0.5 transition-opacity duration-150"
            style={{ color: '#ef4444', opacity: 0.7 }}
          >
            <X size={13} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
