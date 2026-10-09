interface NoticeProps {
  message: string | null
  onDismiss: () => void
}

// A status update, not an alert: it waits its turn. Failures are shown in the answer panel instead.
export default function Notice({ message, onDismiss }: NoticeProps) {
  if (!message) return null
  return (
    <div className="ds-notice vox-notice" role="status">
      <p>{message}</p>
      <button type="button" className="ds-button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}
