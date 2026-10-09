import type { DuplicateReport } from '../types'

export type LiveState = 'idle' | 'live' | 'failed'

export interface LiveData {
  state: LiveState
  /** The words shown in the masthead chip. */
  text: string
}

/** The hosts behind the indicator: the issues are fetched by the browser, the duplicate search by the server. */
export const LIVE_DATA_HOSTS = 'api.github.com (issue lists and issues, fetched by your browser; the duplicate search, fetched by the server)'

interface Input {
  loading: boolean
  /** A GitHub error from loading the issues, or null. */
  issuesError: string | null
  /** When the last issue fetch succeeded and parsed, or null if none has. */
  fetchedAt: number | null
  /** The duplicate check of the run on screen, or null. */
  duplicates: DuplicateReport | null
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * Idle until a GitHub fetch has really succeeded, lit with its time once one has, and failed when the issue fetch
 * failed or the duplicate search could not reach GitHub (no candidates and the step unavailable). A model failure
 * in the judge keeps its candidates, so it does not read as a GitHub failure. Model text is never counted as data.
 */
export function liveDataOf({ loading, issuesError, fetchedAt, duplicates }: Input): LiveData {
  const searchFailed = duplicates?.status === 'unavailable' && duplicates.candidates.length === 0
  if (issuesError !== null || searchFailed) return { state: 'failed', text: 'Live data unavailable: GitHub' }
  if (loading || fetchedAt === null) return { state: 'idle', text: 'Live data: GitHub' }
  return { state: 'live', text: `Live data: GitHub · fetched ${clock(fetchedAt)}` }
}
