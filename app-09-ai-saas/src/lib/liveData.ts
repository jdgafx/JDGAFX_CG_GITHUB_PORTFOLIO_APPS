/** The "Live data: npm registry" indicator: which state it is in, and the words it shows. */

export const LIVE_SOURCE = 'npm registry'
export const LIVE_HOSTS = 'api.npmjs.org, registry.npmjs.org'

export type LiveState = 'idle' | 'live' | 'failed'

export interface LiveInputs {
  /** The first downloads request is still going and nothing has loaded yet. */
  downloadsLoading: boolean
  /** Packages whose daily downloads were fetched and parsed, and packages whose request failed. */
  downloadsParsed: number
  downloadsFailed: number
  /** The registry release history is still loading. */
  releasesLoading: boolean
  /** Packages whose registry document was fetched and parsed, and packages whose read failed. */
  releasesParsed: number
  releasesFailed: number
}

/** What a source said for one package: it worked, or why it did not. */
export type SourceResult = 'ok' | 'not-found' | 'failed'

/**
 * The inputs of the state, from what each source said for each selected package. A name npm does not know is the visitor's
 * input, not npm being unavailable, so it counts as neither parsed nor failed.
 */
export function liveInputs(downloads: { loading: boolean; results: SourceResult[] }, releases: { loading: boolean; results: SourceResult[] }): LiveInputs {
  const count = (list: SourceResult[], what: SourceResult) => list.filter((r) => r === what).length
  return {
    downloadsLoading: downloads.loading && count(downloads.results, 'ok') === 0,
    downloadsParsed: downloads.loading ? 0 : count(downloads.results, 'ok'),
    downloadsFailed: downloads.loading ? 0 : count(downloads.results, 'failed'),
    releasesLoading: releases.loading,
    releasesParsed: count(releases.results, 'ok'),
    releasesFailed: count(releases.results, 'failed'),
  }
}

/**
 * Live only when the real downloads and the real registry reads for the current selection both succeeded and parsed.
 * Failed as soon as either source failed for a package, so the chip never claims more than was fetched. Idle until the
 * first fetches settle.
 */
export function liveState(i: LiveInputs): LiveState {
  if (i.downloadsFailed > 0 || i.releasesFailed > 0) return 'failed'
  if (i.downloadsLoading || i.releasesLoading) return 'idle'
  return i.downloadsParsed > 0 && i.releasesParsed > 0 ? 'live' : 'idle'
}

/** The time a fetch finished, as the visitor's local HH:MM. */
export const fetchedTime = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

/** The chip's words for a state. */
export function liveText(state: LiveState, fetchedAt: number | null): string {
  if (state === 'failed') return `Live data unavailable: ${LIVE_SOURCE}`
  if (state === 'live' && fetchedAt !== null) return `Live data: ${LIVE_SOURCE} · fetched ${fetchedTime(fetchedAt)}`
  return `Live data: ${LIVE_SOURCE}`
}
