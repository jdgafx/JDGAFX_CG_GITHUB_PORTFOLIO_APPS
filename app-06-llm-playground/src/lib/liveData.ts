import type { CatalogueResponse } from '../../netlify/shared/contract'
import type { BoardState } from './useArena'

export type LiveState = 'idle' | 'live' | 'failed'

export interface LiveIndicator {
  state: LiveState
  label: string
  /** The exact endpoints behind this view. */
  title: string
}

const TITLE = 'openrouter.ai (model list, through /api/models); visitor ballots (through /api/leaderboard)'

export const clock = (iso: string): string => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * The masthead chip. The model answers are model output and are not labelled data; the chip is about the two
 * things the page fetches: OpenRouter's model list and the leaderboard built from real visitor ballots.
 * It lights only when the model list is live (a cached or built-in list is not) and the board loaded.
 */
export function liveIndicator(catalogue: CatalogueResponse | null, catalogueFailed: boolean, board: BoardState): LiveIndicator {
  if (catalogueFailed || (catalogue && catalogue.source !== 'live')) {
    return { state: 'failed', label: 'Live data unavailable: OpenRouter models', title: TITLE }
  }
  if (!catalogue || board.state === 'loading') {
    return { state: 'idle', label: 'Live data: OpenRouter models · leaderboard from visitor votes', title: TITLE }
  }
  if (board.state === 'error') {
    return { state: 'failed', label: 'Live data unavailable: leaderboard from visitor votes', title: TITLE }
  }
  const at = catalogue.fetchedAt ? ` · fetched ${clock(catalogue.fetchedAt)}` : ''
  return { state: 'live', label: `Live data: OpenRouter models · leaderboard from visitor votes${at}`, title: TITLE }
}
