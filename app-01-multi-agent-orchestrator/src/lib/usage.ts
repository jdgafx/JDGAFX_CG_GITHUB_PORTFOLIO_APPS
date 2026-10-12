import type { StageUsage } from '../types'

const FIELDS = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const

/**
 * Adds up per-stage usage. A figure is reported only when every counted stage reported
 * it, so a partial run never shows a total that looks complete. Used by the server and
 * the browser, so both produce the same numbers.
 */
export function sumUsage(stages: Array<StageUsage | undefined>): StageUsage {
  const total: StageUsage = {}
  for (const field of FIELDS) {
    let sum = 0
    let complete = stages.length > 0
    for (const stage of stages) {
      const value = stage?.[field]
      if (value === undefined) {
        complete = false
        break
      }
      sum += value
    }
    if (complete) total[field] = sum
  }
  return total
}

/**
 * Adds up what the calls reported, field by field, and counts the calls that left a figure out. When `gaps` is above 0 the
 * sums are a floor: at least that much was billed. Unlike sumUsage, a missing figure does not hide the figures that exist.
 */
export function sumKnown(calls: Array<StageUsage | undefined>): { usage: StageUsage; gaps: number } {
  const usage: StageUsage = {}
  for (const field of FIELDS) {
    const known = calls.flatMap(call => (call?.[field] === undefined ? [] : [call[field]]))
    if (known.length > 0) usage[field] = known.reduce((sum, value) => sum + value, 0)
  }
  return { usage, gaps: calls.filter(call => FIELDS.some(field => call?.[field] === undefined)).length }
}

export function formatCount(value: number | undefined): string {
  return value === undefined ? 'not reported' : value.toLocaleString('en-US')
}

export function formatMs(value: number | undefined): string {
  return value === undefined ? 'not reported' : `${value.toLocaleString('en-US')} ms`
}

export function formatUsd(value: number | undefined): string {
  return value === undefined ? 'not reported' : `$${value.toFixed(6)}`
}
