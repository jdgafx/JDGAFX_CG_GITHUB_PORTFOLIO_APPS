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
  /** The last Commons search that came back with pictures, listed in the picker on load: how many, and when. */
  listing?: { count: number; at: number } | null
}

const HOSTS = 'commons.wikimedia.org, upload.wikimedia.org'
const OWN = 'Your own file, read in your browser. Nothing was fetched.'

export const clock = (at: number): string => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * The masthead chip. A picture chosen from Wikimedia Commons was fetched live, so it lights as live data; a file the
 * visitor dropped, pasted or chose is their own input and reads "Your file", never "Live data". Model text is not data.
 */
export function liveIndicator({ loaded, at, commonsFailed, listing = null }: LiveInput): LiveIndicator {
  if (loaded.length === 0) {
    if (commonsFailed) return { state: 'failed', label: 'Live data unavailable: Wikimedia Commons', title: HOSTS }
    // The picker lists live Commons results as soon as the page loads, before any picture is chosen.
    if (listing) {
      const pictures = listing.count === 1 ? '1 picture' : `${listing.count} pictures`
      return { state: 'live', label: `Live data: Wikimedia Commons · ${pictures} listed ${clock(listing.at)}`, title: HOSTS }
    }
    return { state: 'idle', label: 'Live data: Wikimedia Commons · or your own file', title: `${HOSTS}. A file you choose is read in your browser.` }
  }
  const commons = loaded.some(image => image !== null)
  const own = loaded.some(image => image === null)
  if (commons && own) return { state: 'live', label: `Live data: Wikimedia Commons + your file${at === null ? '' : ` · fetched ${clock(at)}`}`, title: HOSTS }
  if (commons) return { state: 'live', label: `Live data: Wikimedia Commons${at === null ? '' : ` · fetched ${clock(at)}`}`, title: HOSTS }
  return { state: 'live', label: `Your file${at === null ? '' : ` · read ${clock(at)}`}`, title: OWN }
}

export interface LoadedPictures {
  hasA: boolean
  hasB: boolean
  sourceA: CommonsImage | null
  sourceB: CommonsImage | null
  /** True while picture A is the one a stored recording carried. It was not fetched now, so it never counts as loaded. */
  recordedA: boolean
}

/** The slots the chip reads: a recorded picture is left out, so a replay never lights the chip as live data. */
export function loadedSlots({ hasA, hasB, sourceA, sourceB, recordedA }: LoadedPictures): (CommonsImage | null)[] {
  const slots: (CommonsImage | null)[] = []
  if (hasA && !recordedA) slots.push(sourceA)
  if (hasB) slots.push(sourceB)
  return slots
}
