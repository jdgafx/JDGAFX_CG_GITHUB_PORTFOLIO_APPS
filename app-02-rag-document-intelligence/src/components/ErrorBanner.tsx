interface ErrorBannerProps {
  message: string | null
}

/** Upload and question problems share this one notice, so a second error never appears somewhere else. */
export function ErrorBanner({ message }: ErrorBannerProps) {
  if (!message) return null
  return (
    <div className="ds-notice ds-notice--error" role="alert">
      {message}
    </div>
  )
}
