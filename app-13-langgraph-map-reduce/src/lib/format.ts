import type { CostSource } from '../types/frames'

export function formatMs(ms: number): string {
  return `${Math.round(ms).toLocaleString('en-US')} ms`
}

export function formatTokens(tokens: number): string {
  return tokens.toLocaleString('en-US')
}

/** Dollar cost with enough decimals for sub-cent calls. A missing cost is shown as n/a, never as zero. */
export function formatCost(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return 'n/a'
  return `$${cost.toFixed(6)}`
}

export function costNote(source: CostSource | undefined): string {
  return source === 'estimated' ? 'estimated' : ''
}

export function formatCount(count: number, word: string): string {
  return `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`
}
