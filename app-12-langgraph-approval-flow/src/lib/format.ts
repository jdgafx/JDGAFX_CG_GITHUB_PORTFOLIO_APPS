import type { RunTotals } from '../types'

/** A duration: milliseconds under a second, seconds above it. */
export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`
}

/** A USD cost. Estimates are labelled, and a cost the provider did not report reads as "not reported". */
export function formatCost(cost: number | undefined, source: 'usage' | 'estimated' | undefined): string {
  if (cost === undefined) return 'not reported'
  return `$${cost.toFixed(6)}${source === 'estimated' ? ' (estimated)' : ''}`
}

/** The note on a total that is missing calls, such as "1 call not reported". */
function missing(calls: number): string {
  return `${calls} call${calls === 1 ? '' : 's'} not reported`
}

/** The run's token total. A total missing calls reads "at least" with the number of calls missing, and is never shown as complete. */
export function formatTotalTokens(totals: Pick<RunTotals, 'tokens' | 'unreportedCalls'>): string {
  if (totals.tokens === null) return 'not reported'
  const sum = totals.tokens.toLocaleString('en-US')
  return totals.unreportedCalls > 0 ? `at least ${sum} (${missing(totals.unreportedCalls)})` : sum
}

/** The run's cost total, labelled as an estimate when any part was estimated, and "at least" when calls are missing. */
export function formatTotalCost(totals: Pick<RunTotals, 'cost' | 'costSource' | 'unreportedCalls'>): string {
  if (totals.cost === null) return 'not reported'
  const sum = formatCost(totals.cost, totals.costSource ?? undefined)
  return totals.unreportedCalls > 0 ? `at least ${sum} (${missing(totals.unreportedCalls)})` : sum
}

export function formatTokens(tokens: number | undefined | null): string {
  return tokens === undefined || tokens === null ? 'not reported' : tokens.toLocaleString('en-US')
}

/** How long ago an ISO time was, in the largest whole unit: "5 min ago", "3 days ago", "2 months ago". */
export function formatAge(iso: string, nowMs: number = Date.now()): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return 'unknown age'
  const minutes = Math.max(0, Math.floor((nowMs - then) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  return months < 24 ? `${months} months ago` : `${Math.floor(days / 365)} years ago`
}
