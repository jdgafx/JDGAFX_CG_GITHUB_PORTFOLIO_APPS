interface BannersProps {
  error: string | null
  notice: string | null
  onDismissError: () => void
  onDismissNotice: () => void
}

export default function Banners({ error, notice, onDismissError, onDismissNotice }: BannersProps) {
  return (
    <>
      {error && (
        <div className="ds-notice ds-notice--error app-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="ds-button app-banner__dismiss" aria-label="Dismiss error" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="ds-notice app-banner" role="status">
          <span>{notice}</span>
          <button type="button" className="ds-button app-banner__dismiss" aria-label="Dismiss notice" onClick={onDismissNotice}>
            Dismiss
          </button>
        </div>
      )}
    </>
  )
}
