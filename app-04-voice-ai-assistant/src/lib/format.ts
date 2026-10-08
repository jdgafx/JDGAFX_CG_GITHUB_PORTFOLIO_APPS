const NOT_REPORTED = 'not reported'

export function formatMs(ms: number | undefined): string {
  return ms === undefined ? NOT_REPORTED : `${Math.round(ms).toLocaleString('en-US')} ms`
}

export function formatCount(count: number | undefined): string {
  return count === undefined ? NOT_REPORTED : count.toLocaleString('en-US')
}

// Six decimals: a single reply costs a fraction of a cent.
export function formatUsd(cost: number | undefined): string {
  return cost === undefined ? NOT_REPORTED : `$${cost.toFixed(6)}`
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
