interface BannerProps {
  tone: 'error' | 'info'
  message: string | null
  onDismiss: () => void
}

// Errors use role="alert" and interrupt; notices are status updates and wait their turn.
export default function Banner({ tone, message, onDismiss }: BannerProps) {
  if (!message) return null
  const isError = tone === 'error'
  return (
    <div
      className={isError ? 'ds-notice ds-notice--error vox-banner' : 'ds-notice vox-banner'}
      role={isError ? 'alert' : 'status'}
    >
      <p>{message}</p>
      <button type="button" className="ds-button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}
