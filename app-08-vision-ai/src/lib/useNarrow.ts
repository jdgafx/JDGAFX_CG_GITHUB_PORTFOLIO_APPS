import { useSyncExternalStore } from 'react'

const WIDE = '(min-width: 1000px)'

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** True below 1000 px, where the rail sits above the run column (the same breakpoint the shared layout uses). */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !window.matchMedia(WIDE).matches,
    () => false,
  )
}
