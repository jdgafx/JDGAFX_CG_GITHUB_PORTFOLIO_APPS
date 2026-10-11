import { useEffect, useRef } from 'react'

interface ErrorBannerProps {
  message: string | null
}

/** Upload and question problems share this one notice, so a second error never appears somewhere else. */
export function ErrorBanner({ message }: ErrorBannerProps) {
  const ref = useRef<HTMLDivElement>(null)
  // A new notice scrolls into view above the sticky Ask bar (the rail's scroll-padding-bottom leaves room for it).
  useEffect(() => {
    if (message) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [message])
  if (!message) return null
  return (
    <div ref={ref} className="ds-notice ds-notice--error" role="alert">
      {message}
    </div>
  )
}
