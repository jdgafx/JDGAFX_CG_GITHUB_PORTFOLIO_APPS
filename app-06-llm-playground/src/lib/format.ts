import type { Cost } from '../../netlify/shared/contract'

export function formatMs(ms: number | null): string {
  return ms === null ? 'not reported' : `${Math.round(ms).toLocaleString('en-US')} ms`
}

export function formatCount(n: number | null): string {
  return n === null ? 'not reported' : n.toLocaleString('en-US')
}

export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.000001) return '< $0.000001'
  return `$${usd.toFixed(6)}`
}

export function formatCost(cost: Cost | null): string {
  return cost === null ? 'not reported' : `${formatUsd(cost.usd)} (${cost.source})`
}

export function tokensPerSecond(tokens: number | null, latencyMs: number | null): string {
  if (tokens === null || latencyMs === null || latencyMs <= 0) return 'not reported'
  return (tokens / (latencyMs / 1000)).toFixed(1)
}

function perMillion(value: number | null): string {
  if (value === null) return 'not listed'
  if (value === 0) return '$0'
  return value < 0.01 ? `$${value.toPrecision(2)}` : `$${value.toFixed(2)}`
}

export function formatPrice(inPerM: number | null, outPerM: number | null): string {
  if (inPerM === null && outPerM === null) return 'price not listed'
  return `${perMillion(inPerM)} in / ${perMillion(outPerM)} out per 1M`
}

// Bar length for a measured value, relative to the largest value in the same run.
export function barPercent(value: number, scale: number | null): number {
  if (!scale || scale <= 0) return 0
  return Math.min(100, (value / scale) * 100)
}
