import type { Usage } from './api'

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

// What a run spent, as the lines the answer card shows. A run with calls that reported no usage says "at least"
// and how many, never a complete total; a run where no call reported says so instead of showing zero.
export function usageBits(usage: Usage | undefined): string[] {
  if (!usage) return []
  const missing = usage.unreportedCalls ?? 0
  const calls = `${missing} ${missing === 1 ? 'call' : 'calls'}`
  const bits: string[] = []
  if (usage.total_tokens !== undefined) bits.push(`${missing > 0 ? 'at least ' : ''}${formatCount(usage.total_tokens)} tokens`)
  if (usage.cost !== undefined) bits.push(missing > 0 ? `at least ${formatUsd(usage.cost)} (${calls} not reported)` : formatUsd(usage.cost))
  if (bits.length === 0 && missing > 0) bits.push(`tokens and cost not reported (${calls})`)
  return bits
}
