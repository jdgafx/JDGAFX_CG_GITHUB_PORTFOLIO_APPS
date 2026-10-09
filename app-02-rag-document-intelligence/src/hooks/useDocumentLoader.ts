import { useCallback, useEffect, useRef, useState } from 'react'
import { describeRequest, loadSource, type SourceRequest } from '../lib/loadSource'
import type { DocumentState } from '../types'

interface DocumentLoader {
  /** True while a source is being fetched or read. */
  loading: boolean
  /** What is being loaded, for the status line. Null when idle. */
  activity: string | null
  error: string | null
  /** True when the last request failed and can be run again. */
  canRetry: boolean
  /** Which source the last failed request was reading, for the live-data chip. */
  failedKind: SourceRequest['kind'] | null
  load: (request: SourceRequest) => void
  retry: () => void
  /** Shows a problem found before loading, such as an unsupported file type. */
  fail: (message: string) => void
  clearError: () => void
}

/**
 * Loads documents from a file, Wikipedia or arXiv. A new request replaces one still in
 * flight, and a late result from the old one is ignored. `onLoaded` gets each finished document.
 */
export function useDocumentLoader(onLoaded: (doc: DocumentState) => void, onStart: () => void): DocumentLoader {
  const [activity, setActivity] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState<SourceRequest | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const load = useCallback(
    (request: SourceRequest) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      onStart()
      setError(null)
      setFailed(null)
      setActivity(describeRequest(request))
      loadSource(request, controller.signal)
        .then(doc => {
          if (!controller.signal.aborted) onLoaded(doc)
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          console.warn('DocMind could not load the source:', err instanceof Error ? err.message : 'unknown error')
          setError(err instanceof Error ? err.message : 'This source could not be loaded.')
          setFailed(request)
        })
        .finally(() => {
          if (abortRef.current === controller) {
            abortRef.current = null
            setActivity(null)
          }
        })
    },
    [onLoaded, onStart],
  )

  const retry = useCallback(() => {
    if (failed) load(failed)
  }, [failed, load])

  const fail = useCallback((message: string) => {
    setError(message)
    setFailed(null)
  }, [])

  const clearError = useCallback(() => {
    setError(null)
    setFailed(null)
  }, [])

  return { loading: activity !== null, activity, error, canRetry: failed !== null, failedKind: failed?.kind ?? null, load, retry, fail, clearError }
}
