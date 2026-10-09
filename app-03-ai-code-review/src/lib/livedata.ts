/** Where the facts and inputs of the current view came from. The model's own text is not data and is never labelled as such. */
export interface LiveInput {
  mode: 'file' | 'pr'
  /** When a file or pull request was fetched from GitHub and parsed, for the view now shown. Null before one is. */
  fetchedAt: Date | null
  /** True when the last GitHub fetch failed. */
  failed: boolean
  /** The editor holds code, and it did not come from the GitHub file shown (pasted or edited). */
  ownCode: boolean
}

export interface LiveData {
  state: 'idle' | 'live' | 'failed'
  text: string
  /** The exact hosts the page talks to for this input. */
  title: string
}

const HOSTS = 'api.github.com'

export const clock = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/**
 * The live-data indicator. Idle until a real fetch has been parsed; live only then, with its time; failed when the fetch
 * failed. Pasted code is the visitor's own data and is labelled as such.
 */
export function liveData({ mode, fetchedAt, failed, ownCode }: LiveInput): LiveData {
  if (failed) return { state: 'failed', text: 'Live data unavailable: GitHub', title: HOSTS }
  if (mode === 'file' && ownCode) return { state: 'idle', text: 'Your code', title: 'Pasted or edited in this page; not fetched' }
  if (fetchedAt) return { state: 'live', text: `Live data: GitHub · fetched ${clock(fetchedAt)}`, title: HOSTS }
  return { state: 'idle', text: 'Live data: your code + GitHub', title: HOSTS }
}
