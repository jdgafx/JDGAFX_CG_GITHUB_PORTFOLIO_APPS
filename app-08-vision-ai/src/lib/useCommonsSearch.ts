import { useCallback, useEffect, useRef, useState } from 'react'
import { CommonsError, searchCommons } from './commons'
import type { CommonsImage } from './commons'

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'ready'; query: string; images: CommonsImage[] }
  | { status: 'error'; query: string; message: string }

const SEARCH_FAILED = 'The search failed unexpectedly. Try again.'

// One Commons search at a time: a new search cancels the one before it, and leaving the page cancels both.
export function useCommonsSearch() {
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const search = useCallback(async (raw: string) => {
    const query = raw.trim()
    if (!query) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState({ status: 'loading', query })
    try {
      const images = await searchCommons(query, controller.signal)
      if (!controller.signal.aborted) setState({ status: 'ready', query, images })
    } catch (err) {
      if (controller.signal.aborted) return
      setState({ status: 'error', query, message: err instanceof CommonsError ? err.message : SEARCH_FAILED })
    }
  }, [])

  return { state, search }
}
