// The "Live data" indicator: which public sources this run really fetched. It lights only when a tool call
// succeeded and returned a source; a failed lookup shows as unavailable. Model text is not data and is not counted.
import type { TraceStep } from './api'

export type LiveState = 'idle' | 'live' | 'failed'

export interface LiveData {
  state: LiveState
  /** The sources named in the chip. */
  sources: string[]
  /** Local time (HH:MM) of the newest successful fetch. */
  fetchedAt?: string
}

/** Every public source the tools can reach, named for the idle chip, with the hosts for its tooltip. */
export const ALL_SOURCES = ['Open-Meteo', 'Wikipedia']
export const HOSTS = 'geocoding-api.open-meteo.com, api.open-meteo.com, en.wikipedia.org'

function sourceOf(step: Pick<TraceStep, 'call'>): string | null {
  if (step.call?.startsWith('weather(')) return 'Open-Meteo'
  if (step.call?.startsWith('wikipedia_summary(')) return 'Wikipedia'
  return null
}

const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * `fetched` lists the wall-clock time each tool step arrived, by step index. A tool step with status "ok" and a
 * source link counts as a real fetch; one that failed makes the chip say the source is unavailable.
 */
export function liveData(steps: Array<Pick<TraceStep, 'call' | 'status' | 'source'>>, fetched: Record<number, number> = {}): LiveData {
  const ok = new Set<string>()
  const failed = new Set<string>()
  let newest: number | undefined
  steps.forEach((step, i) => {
    const source = sourceOf(step)
    if (!source) return
    if (step.status === 'ok' && step.source) {
      ok.add(source)
      if (fetched[i] !== undefined) newest = Math.max(newest ?? 0, fetched[i])
    } else if (step.status === 'failed') failed.add(source)
  })
  if (failed.size > 0) return { state: 'failed', sources: [...failed] }
  if (ok.size > 0) return { state: 'live', sources: [...ok], fetchedAt: newest === undefined ? undefined : clock(newest) }
  return { state: 'idle', sources: ALL_SOURCES }
}

export function liveText(live: LiveData): string {
  const names = live.sources.join(', ')
  if (live.state === 'failed') return `Live data unavailable: ${names}`
  if (live.state === 'live') return `Live data: ${names}${live.fetchedAt ? `, fetched ${live.fetchedAt}` : ''}`
  return `Live data: ${names}`
}
