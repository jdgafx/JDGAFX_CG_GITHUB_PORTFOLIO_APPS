import type { CommonsImage } from './commons'

export type LiveState = 'idle' | 'live' | 'failed'

export interface LiveIndicator {
  state: LiveState
  label: string
  /** The exact hosts behind this view. */
  title: string
}

export interface LiveInput {
  /** The Commons credit of each loaded picture, or null for one the visitor supplied. Absent slots are left out. */
  loaded: (CommonsImage | null)[]
  /** When the current pictures were loaded. */
  at: number | null
  /** True when the last Commons search or download failed. */
  commonsFailed: boolean
}

const HOSTS = 'commons.wikimedia.org, upload.wikimedia.org'
const OWN = 'Your own file, read in your browser. Nothing was fetched.'

export const clock = (at: number): string => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * The masthead chip. A picture chosen from Wikimedia Commons was fetched live, so it lights as live data; a file the
 * visitor dropped, pasted or chose is their own input and reads "Your file", never "Live data". Model text is not data.
 */
export function liveIndicator({ loaded, at, commonsFailed }: LiveInput): LiveIndicator {
  if (loaded.length === 0) {
    return commonsFailed
      ? { state: 'failed', label: 'Live data unavailable: Wikimedia Commons', title: HOSTS }
      : { state: 'idle', label: 'Live data: Wikimedia Commons · or your own file', title: `${HOSTS}. A file you choose is read in your browser.` }
  }
  const when = at === null ? '' : ` · ${clock(at)}`
  const commons = loaded.some(image => image !== null)
  const own = loaded.some(image => image === null)
  if (commons && own) return { state: 'live', label: `Live data: Wikimedia Commons + your file${when}`, title: HOSTS }
  if (commons) return { state: 'live', label: `Live data: Wikimedia Commons${at === null ? '' : ` · fetched ${clock(at)}`}`, title: HOSTS }
  return { state: 'live', label: `Your file${at === null ? '' : ` · read ${clock(at)}`}`, title: OWN }
}
