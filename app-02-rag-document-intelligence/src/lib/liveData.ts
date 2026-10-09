import type { DocumentState } from '../types'
import type { SourceRequest } from './loadSource'

export type LiveState = 'idle' | 'live' | 'failed'

export interface LiveData {
  state: LiveState
  /** The chip text. */
  label: string
  /** The exact hosts the browser talks to for this view. */
  title: string
}

const IDLE_LABEL = 'Live data: Wikipedia · arXiv · your file'
const IDLE_TITLE = 'en.wikipedia.org, arxiv.org. A file you choose is read in your browser.'

const FAILED: Record<SourceRequest['kind'], { label: string; title: string }> = {
  wikipedia: { label: 'Live data unavailable: Wikipedia', title: 'en.wikipedia.org' },
  arxiv: { label: 'Live data unavailable: arXiv', title: 'arxiv.org' },
  file: { label: 'Your file could not be read', title: 'A file you choose is read in your browser.' },
}

export const clock = (at: number): string => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * What the masthead chip says. A document exists only after its source was fetched (or the file read) and parsed,
 * so a loaded document is the one thing that lights the chip. A failed load reads failed; nothing else does.
 */
export function liveData(doc: Pick<DocumentState, 'source'> | null, loadedAt: number | null, failedKind: SourceRequest['kind'] | null): LiveData {
  if (doc && loadedAt !== null) {
    const when = clock(loadedAt)
    if (doc.source.label === 'arXiv') return { state: 'live', label: `Live data: arXiv · fetched ${when}`, title: 'arxiv.org' }
    if (doc.source.label.startsWith('Wikipedia')) return { state: 'live', label: `Live data: Wikipedia · fetched ${when}`, title: 'en.wikipedia.org' }
    return { state: 'live', label: `Your file · read ${when}`, title: 'Your own file, read in your browser. Nothing was fetched.' }
  }
  if (failedKind) return { state: 'failed', ...FAILED[failedKind] }
  return { state: 'idle', label: IDLE_LABEL, title: IDLE_TITLE }
}
