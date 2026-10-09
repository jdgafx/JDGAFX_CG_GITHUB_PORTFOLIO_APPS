interface BannersProps {
  error: string | null
  notice: string | null
  onDismissError: () => void
  onDismissNotice: () => void
}

interface BannerProps {
  message: string
  label: string
  tone: string
  role: 'alert' | 'status'
  onDismiss: () => void
}

function Banner({ message, label, tone, role, onDismiss }: BannerProps) {
  return (
    <div className={`ds-notice ${tone} app-banner`} role={role}>
      <span>{message}</span>
      <button type="button" className="ds-button app-banner__dismiss" aria-label={label} onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}

export default function Banners({ error, notice, onDismissError, onDismissNotice }: BannersProps) {
  return (
    <>
      {error && <Banner message={error} label="Dismiss error" tone="ds-notice--error" role="alert" onDismiss={onDismissError} />}
      {notice && <Banner message={notice} label="Dismiss notice" tone="" role="status" onDismiss={onDismissNotice} />}
    </>
  )
}
