import { useCallback, useEffect, useState } from 'react'
import { fetchFrontPage, type HnStory } from './hackerNews'

export type FrontPage =
  | { status: 'loading' }
  | { status: 'ready'; stories: HnStory[]; at: number }
  | { status: 'failed' }

/** Reads the Hacker News front page once on load, and again when `reload` is called. It never starts a model call. */
export function useFrontPage(): { page: FrontPage; reload: () => void } {
  const [page, setPage] = useState<FrontPage>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchFrontPage(window.fetch.bind(window), controller.signal).then(
      (stories) => {
        if (!controller.signal.aborted) setPage({ status: 'ready', stories, at: Date.now() })
      },
      () => {
        if (!controller.signal.aborted) setPage({ status: 'failed' })
      },
    )
    return () => controller.abort()
  }, [attempt])

  const reload = useCallback(() => {
    setPage({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])
  return { page, reload }
}
