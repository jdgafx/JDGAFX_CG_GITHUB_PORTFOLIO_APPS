/** Why a watchdog gave up: nothing arrived for the idle time, or the whole wait ran past its cap. */
export type WatchdogReason = 'idle' | 'cap'

export interface Watchdog {
  /** Call on every byte received; it restarts the idle clock. */
  kick: () => void
  /** Cancels both clocks. Call when the wait is over. */
  stop: () => void
}

/**
 * Guards a long request: fires `onFire` once if no byte arrives for `idleMs`, or when `capMs` have passed in total.
 * The timers are ordinary, referenced timers, so they run even when the request itself never settles.
 */
export function startWatchdog(idleMs: number, capMs: number, onFire: (reason: WatchdogReason) => void): Watchdog {
  let done = false
  const fire = (reason: WatchdogReason) => {
    if (done) return
    done = true
    clearTimeout(idle)
    clearTimeout(cap)
    onFire(reason)
  }
  let idle = setTimeout(() => fire('idle'), idleMs)
  const cap = setTimeout(() => fire('cap'), capMs)
  return {
    kick: () => {
      if (done) return
      clearTimeout(idle)
      idle = setTimeout(() => fire('idle'), idleMs)
    },
    stop: () => {
      done = true
      clearTimeout(idle)
      clearTimeout(cap)
    },
  }
}
