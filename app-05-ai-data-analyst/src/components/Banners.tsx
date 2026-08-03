import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, Info, X } from 'lucide-react'

interface BannersProps {
  error: string | null
  notice: string | null
  onDismissError: () => void
  onDismissNotice: () => void
}

interface BannerProps {
  tone: 'error' | 'info'
  message: string
  onDismiss: () => void
}

const TONES = {
  error: {
    role: 'alert' as const,
    background: 'rgba(255,68,68,0.1)',
    border: '1px solid rgba(255,68,68,0.25)',
    color: '#ff6666',
    dismissLabel: 'Dismiss error',
  },
  info: {
    role: 'status' as const,
    background: 'rgba(255,170,0,0.08)',
    border: '1px solid rgba(255,170,0,0.22)',
    color: '#ffbb44',
    dismissLabel: 'Dismiss notice',
  },
}

function Banner({ tone, message, onDismiss }: BannerProps) {
  const style = TONES[tone]
  const Icon = tone === 'error' ? AlertCircle : Info
  return (
    <motion.div
      role={style.role}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        background: style.background,
        border: style.border,
        borderRadius: '10px',
        padding: '12px 16px',
        color: style.color,
        fontSize: '13px',
        lineHeight: 1.5,
      }}
    >
      <Icon size={15} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
      <span style={{ flex: 1 }}>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss this message"
        aria-label={style.dismissLabel}
        style={{
          background: 'transparent',
          border: 'none',
          color: style.color,
          cursor: 'pointer',
          padding: 0,
          lineHeight: 0,
        }}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </motion.div>
  )
}

export default function Banners({
  error,
  notice,
  onDismissError,
  onDismissNotice,
}: BannersProps) {
  return (
    <AnimatePresence>
      {error && <Banner key="error" tone="error" message={error} onDismiss={onDismissError} />}
      {notice && <Banner key="notice" tone="info" message={notice} onDismiss={onDismissNotice} />}
    </AnimatePresence>
  )
}
