import type { RunState } from './runState'

/** The live-data indicator: where the facts come from, and whether the real fetch has happened. */
export interface LiveData {
  state: 'idle' | 'live' | 'failed'
  text: string
  /** The exact hosts and fetcher, for the tooltip. */
  title: string
}

const VIA = 'via headless Chromium'

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/** The hosts the plan opens, in order and without repeats. */
export function plannedHosts(state: RunState): string[] {
  const hosts = state.steps.flatMap((step) => (step.url ? [hostOf(step.url)] : [])).filter((host): host is string => host !== null)
  return [...new Set(hosts)]
}

/** HH:MM on a 24-hour clock in the visitor's time zone. */
export function clock(at: number): string {
  return new Date(at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * Idle until the browser has really read a page. Live from the first step that finished with a page
 * (the source is that page's host). Failed when the run failed before any page was read.
 */
export function liveDataOf(state: RunState): LiveData {
  const planned = plannedHosts(state)
  const where = planned.join(', ') || 'allowed sites'
  const title = `A headless Chromium started inside the Netlify function reads the page. Host: ${where}.`
  const first = state.rows.find((row) => row.status === 'ok' && row.observed)
  const host = first?.observed ? hostOf(first.observed.url) : null
  if (state.liveAt !== null && host) {
    return { state: 'live', text: `Live data: ${host} ${VIA} · fetched ${clock(state.liveAt)}`, title: `${title} Read from ${host}.` }
  }
  if (state.phase === 'failed' && state.steps.length > 0) {
    return { state: 'failed', text: `Live data unavailable: ${where} ${VIA}`, title }
  }
  return { state: 'idle', text: `Live data: ${where} ${VIA}`, title }
}
