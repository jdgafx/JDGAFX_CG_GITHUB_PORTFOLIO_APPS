export type Slot = 'loading' | 'ok' | 'failed'
export type LiveState = 'idle' | 'live' | 'downloads-blocked' | 'releases-blocked'

const HOSTS = 'api.npmjs.org (downloads), registry.npmjs.org (releases, through this site)'

/**
 * The masthead chip's state from the two fetches. It stays idle until both have settled, so it never flips from lit
 * to "releases unavailable" a moment later; a downloads failure for every package shows at once.
 */
export function liveState(downloads: Slot[], releases: Slot[]): LiveState {
  if (downloads.length === 0) return 'idle'
  const settled = (s: Slot) => s !== 'loading'
  if (downloads.every(settled) && !downloads.includes('ok')) return 'downloads-blocked'
  if (!downloads.every(settled) || !releases.every(settled)) return 'idle'
  return releases.includes('failed') ? 'releases-blocked' : 'live'
}

const VIEW: Record<LiveState, { cls: string; suffix: string }> = {
  idle: { cls: 'ds-chip--muted', suffix: '' },
  live: { cls: 'ds-chip--live', suffix: '' },
  'downloads-blocked': { cls: 'ds-chip--remove', suffix: ' · unavailable' },
  'releases-blocked': { cls: 'ds-chip--change', suffix: ' · releases unavailable' },
}

export default function LiveChip({ state }: { state: LiveState }) {
  const view = VIEW[state]
  return (
    <p className={`ds-chip ds-chip--wrap ${view.cls} live-chip`} data-state={state} role="status" aria-live="polite" title={HOSTS}>
      Live data: npm registry{view.suffix}
    </p>
  )
}
