/**
 * "Try it": one click picks a real selection that shows the app at its best (four packages over a year, one of them with
 * releases that match its spikes), waits for the live npm data and release history to load, then runs the explanation.
 * Nothing here is a result: every figure is fetched live and the explanation is a real model call.
 */
export const TRY_IT = { names: ['react', 'vite', 'zod', '@anthropic-ai/sdk'], days: 365 } as const

interface TryActions {
  setNames: (names: string[]) => void
  setDays: (days: number) => void
  /** Marks that a run is wanted as soon as the data is ready. */
  queueRun: () => void
}

/** Loads the example selection and queues the run. */
export function startTry(actions: TryActions): void {
  actions.setNames([...TRY_IT.names])
  actions.setDays(TRY_IT.days)
  actions.queueRun()
}

/** True the moment a queued run can start: the figures and the release history for the selection are both ready. */
export const readyToRun = (queued: boolean, ready: boolean): boolean => queued && ready

export const sameSelection = (names: string[], days: number): boolean =>
  days === TRY_IT.days && names.length === TRY_IT.names.length && TRY_IT.names.every((name, i) => names[i] === name)

/** The how-to block's open or closed preference, kept in the browser when it can be. */
const KEY = 'insighthub-howto'
export function readPreference(): 'open' | 'closed' | null {
  try {
    const value = window.localStorage.getItem(KEY)
    return value === 'open' || value === 'closed' ? value : null
  } catch {
    return null
  }
}
export function savePreference(value: 'open' | 'closed'): void {
  try {
    window.localStorage.setItem(KEY, value)
  } catch {
    // Not required: the block simply starts open next time.
  }
}
