export { formatUsd } from './money'

/** A duration: milliseconds under a second, seconds above it. */
export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`
}

/** A USD cost. Estimates are labelled, and a cost the provider did not report reads as "not reported". */
export function formatCost(cost: number | undefined, source: 'usage' | 'estimated' | undefined): string {
  if (cost === undefined) return 'not reported'
  return `$${cost.toFixed(6)}${source === 'estimated' ? ' (estimated)' : ''}`
}

export function formatTokens(tokens: number | undefined | null): string {
  return tokens === undefined || tokens === null ? 'not reported' : tokens.toLocaleString('en-US')
}
