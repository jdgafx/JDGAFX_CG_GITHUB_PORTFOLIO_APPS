import type { AgentState } from '../types'

export type LiveDataState = 'idle' | 'live' | 'failed'

export interface LiveDataView {
  state: LiveDataState
  text: string
  /** The hosts the data comes from, for the chip's tooltip. */
  title: string
}

const HOSTS = 'en.wikipedia.org, hn.algolia.com'
const FALLBACK_SITES = 'Wikipedia + Hacker News'

const clock = (at: Date) => `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`

/**
 * What the masthead says about the data behind the current view. It is live only when the retrieval step finished
 * and returned sources, and it names the sites that really answered. A failed or empty retrieval is "unavailable".
 * The model's own text is not data and never lights it.
 */
export function liveDataView(retriever: Pick<AgentState, 'status' | 'sources'>, fetchedAt: Date | null): LiveDataView {
  const sites = [...new Set((retriever.sources ?? []).map(source => source.site))].join(' + ')
  if (retriever.status === 'error' || (retriever.status === 'complete' && (retriever.sources ?? []).length === 0)) {
    return { state: 'failed', text: `Live data unavailable: ${FALLBACK_SITES}`, title: HOSTS }
  }
  if (retriever.status === 'complete' && fetchedAt && sites) {
    return { state: 'live', text: `Live data: ${sites} · fetched ${clock(fetchedAt)}`, title: HOSTS }
  }
  return { state: 'idle', text: `Live data: ${FALLBACK_SITES}`, title: HOSTS }
}
