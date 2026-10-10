import type { PriceRate } from '../types/frames'

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

/** USD per 1M tokens from a per-token price, to at least cents and at most four decimals. */
const perMillion = (perToken: number): string =>
  (perToken * 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

/** A model's OpenRouter price as the page states it. */
export function formatRate(rate: PriceRate): string {
  return `$${perMillion(rate.prompt)} in, $${perMillion(rate.completion)} out per 1M tokens`
}

export function formatCount(count: number, word: string): string {
  return `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`
}
