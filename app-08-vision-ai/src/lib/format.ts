// Shown in place of any figure the provider did not send, rather than a guessed number.
export const NOT_REPORTED = 'not reported'

export function formatMs(ms: number): string {
  return `${Math.round(ms).toLocaleString('en-US')} ms`
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

export function formatCount(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString('en-US') : NOT_REPORTED
}

export function formatUsd(value: number | undefined): string {
  return typeof value === 'number' ? `$${value.toFixed(6)}` : NOT_REPORTED
}

/** The short form of a model id for a chip: the vendor prefix goes, the full id stays in the title. */
export function shortModel(id: string): string {
  return id.replace(/^[^/]+\//, '')
}
