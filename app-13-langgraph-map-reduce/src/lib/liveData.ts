export type LiveState = 'idle' | 'live' | 'failed'

export interface LiveIndicator {
  state: LiveState
  label: string
  /** The exact host behind this view. */
  title: string
}

/** What the Wikipedia loader just did. */
export type WikiEvent = { kind: 'loaded'; text: string; at: number } | { kind: 'failed' } | { kind: 'loading' }

/** The last article that loaded, kept apart from whether a later load is running or failed. */
export interface WikiFetch {
  loaded: { text: string; at: number } | null
  status: 'idle' | 'loading' | 'failed'
}

export const NO_FETCH: WikiFetch = { loaded: null, status: 'idle' }

export function applyFetch(prev: WikiFetch, event: WikiEvent): WikiFetch {
  if (event.kind === 'loaded') return { loaded: { text: event.text, at: event.at }, status: 'idle' }
  return { loaded: prev.loaded, status: event.kind }
}

const HOST = 'en.wikipedia.org'
const OWN = 'Text you pasted or edited, read in your browser. Nothing was fetched.'

/** The moment a fetch finished. */
export const fetchedNow = (): number => Date.now()

export const clock = (at: number): string => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * The masthead chip. It lights as live data only while the document box still holds the article Wikipedia returned;
 * text the visitor pasted or edited is their own input and reads "Your text". The model's summary is not data.
 */
export function liveIndicator(text: string, fetched: WikiFetch): LiveIndicator {
  if (fetched.loaded !== null && fetched.loaded.text === text) {
    return { state: 'live', label: `Live data: Wikipedia · fetched ${clock(fetched.loaded.at)}`, title: HOST }
  }
  if (text.trim() !== '') return { state: 'live', label: 'Your text', title: OWN }
  if (fetched.status === 'failed') return { state: 'failed', label: 'Live data unavailable: Wikipedia', title: HOST }
  return { state: 'idle', label: 'Live data: Wikipedia · or your pasted text', title: HOST }
}
