export function formatMs(ms: number): string {
  return `${Math.round(ms).toLocaleString('en-US')} ms`
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

// Missing values are shown as "not reported" rather than a guessed number.
export function formatCount(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString('en-US') : 'not reported'
}

export function formatUsd(value: number | undefined): string {
  return typeof value === 'number' ? `$${value.toFixed(6)}` : 'not reported'
}
