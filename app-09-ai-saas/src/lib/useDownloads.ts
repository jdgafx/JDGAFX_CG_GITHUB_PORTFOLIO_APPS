import { useEffect, useState } from 'react'
import { todayUtc } from './dates'
import { loadDownloads, type PackageOutcome } from './npm'

export interface Downloads {
  /** The outcomes of the last finished request. While a new one is loading these are the previous ones, so the page does not blank. */
  outcomes: PackageOutcome[]
  /** The date the request was made for, used to say how far npm lags behind. */
  requestedEnd: string
  loading: boolean
  retry: () => void
}

/** Fetches live daily downloads for the selection from npm, again whenever the selection, the window or a retry changes. */
export function useDownloads(names: string[], days: number): Downloads {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; outcomes: PackageOutcome[]; requestedEnd: string } | null>(null)
  const key = `${names.join(',')}|${days}|${attempt}`

  useEffect(() => {
    const controller = new AbortController()
    const today = todayUtc()
    loadDownloads(names, days, today, controller.signal).then(
      (outcomes) => {
        if (!controller.signal.aborted) setLoaded({ key, outcomes, requestedEnd: today })
      },
      () => undefined,
    )
    return () => controller.abort()
  }, [key, names, days])

  return {
    outcomes: loaded?.outcomes ?? [],
    requestedEnd: loaded?.requestedEnd ?? todayUtc(),
    loading: loaded?.key !== key,
    retry: () => setAttempt((n) => n + 1),
  }
}
