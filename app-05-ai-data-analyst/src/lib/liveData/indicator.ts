import type { DatasetState } from '../../hooks/useLiveDataset'
import type { LiveDatasetId } from './catalog'

export type LiveState = 'idle' | 'live' | 'failed'

export interface LiveIndicator {
  state: LiveState
  label: string
  /** The exact host(s) the browser reads for this view. */
  title: string
}

const SOURCES: Record<LiveDatasetId, { name: string; host: string }> = {
  'quakes-week': { name: 'USGS', host: 'earthquake.usgs.gov' },
  'quakes-month': { name: 'USGS', host: 'earthquake.usgs.gov' },
  weather: { name: 'Open-Meteo', host: 'archive-api.open-meteo.com' },
}

export const clock = (at: Date): string => at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * What the masthead chip says for the dataset in view. It lights only when the rows were fetched and parsed
 * (state `ready` with a live source); a CSV the visitor chose counts as their own input and is not called live.
 */
export function indicatorFor(state: DatasetState, choice: LiveDatasetId | null): LiveIndicator {
  if (choice === null) {
    const upload = state.status === 'ready' ? state.loaded.source : null
    return {
      state: 'live',
      label: upload ? `Your file · ${upload.label}` : 'Your file',
      title: 'Your own CSV, parsed in this browser. Nothing was fetched.',
    }
  }
  const { name, host } = SOURCES[choice]
  if (state.status === 'ready' && state.loaded.source.kind === 'live') {
    return { state: 'live', label: `Live data: ${name} · fetched ${clock(state.loaded.source.fetchedAt)}`, title: host }
  }
  if (state.status === 'error') return { state: 'failed', label: `Live data unavailable: ${name}`, title: host }
  return { state: 'idle', label: `Live data: ${name}`, title: host }
}
