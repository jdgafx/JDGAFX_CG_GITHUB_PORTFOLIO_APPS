export type LiveState = 'idle' | 'live' | 'failed'

export interface LiveIndicator {
  state: LiveState
  label: string
  /** The exact host behind this view. */
  title: string
}

/** What the Wikipedia loader last did: it loaded an article's text at a time, or its fetch failed. */
export type WikiFetch = { kind: 'loaded'; text: string; at: number } | { kind: 'failed' } | { kind: 'loading' }

const HOST = 'en.wikipedia.org'
const OWN = 'Text you pasted or edited, read in your browser. Nothing was fetched.'

/** The moment a fetch finished. */
export const fetchedNow = (): number => Date.now()

export const clock = (at: number): string => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * The masthead chip. It lights as live data only while the document box still holds the article Wikipedia returned;
 * text the visitor pasted or edited is their own input and reads "Your text". The model's summary is not data.
 */
export function liveIndicator(text: string, fetched: WikiFetch | null): LiveIndicator {
  if (fetched?.kind === 'loaded' && fetched.text === text) {
    return { state: 'live', label: `Live data: Wikipedia · fetched ${clock(fetched.at)}`, title: HOST }
  }
  if (text.trim() !== '') return { state: 'live', label: 'Your text', title: OWN }
  if (fetched?.kind === 'failed') return { state: 'failed', label: 'Live data unavailable: Wikipedia', title: HOST }
  return { state: 'idle', label: 'Live data: Wikipedia · or your pasted text', title: HOST }
}
