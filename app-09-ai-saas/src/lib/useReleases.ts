import { useEffect, useState } from 'react'
import { fetchReleases, ReleaseError, type Release } from './releases'

/** A package's release list, or why it could not be had. */
export type ReleaseOutcome = { releases: Release[] } | { error: ReleaseError }

export interface ReleaseHistory {
  /** By package name. Empty while the first request for a selection is loading. */
  outcomes: ReadonlyMap<string, ReleaseOutcome>
  loading: boolean
  retry: () => void
}

/** Successful reads are kept for the visit, so adding a package or retrying does not download the others again. */
const cache = new Map<string, Release[]>()
const NONE: ReadonlyMap<string, ReleaseOutcome> = new Map()

async function load(name: string, signal: AbortSignal): Promise<ReleaseOutcome> {
  const hit = cache.get(name)
  if (hit) return { releases: hit }
  try {
    const releases = await fetchReleases(name, signal)
    cache.set(name, releases)
    return { releases }
  } catch (err) {
    if (signal.aborted) throw err
    return { error: err instanceof ReleaseError ? err : new ReleaseError('network', 'Could not reach the npm registry.') }
  }
}

/** Reads each selected package's release history from the npm registry. It depends on the names only, not the window. */
export function useReleases(names: string[]): ReleaseHistory {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; outcomes: Map<string, ReleaseOutcome> } | null>(null)
  const key = `${names.join(',')}|${attempt}`

  useEffect(() => {
    const controller = new AbortController()
    Promise.all(names.map(async (name) => [name, await load(name, controller.signal)] as const)).then(
      (entries) => {
        if (!controller.signal.aborted) setLoaded({ key, outcomes: new Map(entries) })
      },
      () => undefined,
    )
    return () => controller.abort()
  }, [key, names])

  return {
    outcomes: loaded?.outcomes ?? NONE,
    loading: loaded?.key !== key,
    retry: () => setAttempt((n) => n + 1),
  }
}
