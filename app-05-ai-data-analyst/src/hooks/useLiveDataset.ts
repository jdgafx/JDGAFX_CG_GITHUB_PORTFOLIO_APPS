import { useCallback, useEffect, useState } from 'react'
import type { LiveDatasetId } from '../lib/liveData/catalog'
import { loadDataset } from '../lib/liveData/load'
import type { LoadedDataset } from '../types'

export type DatasetState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; loaded: LoadedDataset }
  | { status: 'error'; message: string }

type Settled = Extract<DatasetState, { status: 'ready' | 'error' }>

const UNEXPECTED = 'The dataset could not be loaded. Try again.'

/**
 * Fetches the chosen live dataset whenever the choice changes and returns its state.
 * Pass null to stand down (an uploaded file is in use). Switching abandons the request
 * in flight, and `reload` fetches the same dataset again.
 */
export function useLiveDataset(id: LiveDatasetId | null, cityId: string) {
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<{ key: string; state: Settled } | null>(null)

  // Only the weather dataset depends on the city.
  const city = id === 'weather' ? cityId : ''
  const key = id === null ? null : `${id}:${city}:${attempt}`

  useEffect(() => {
    if (id === null || key === null) return
    const controller = new AbortController()
    loadDataset({ id, cityId: city }, { signal: controller.signal }).then(
      (loaded) => setSettled({ key, state: { status: 'ready', loaded } }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error && error.name === 'DatasetLoadError' ? error.message : UNEXPECTED
        setSettled({ key, state: { status: 'error', message } })
      },
    )
    return () => controller.abort()
  }, [id, city, key])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])

  let state: DatasetState = { status: 'loading' }
  if (key === null) state = { status: 'idle' }
  else if (settled?.key === key) state = settled.state
  return { state, reload }
}
