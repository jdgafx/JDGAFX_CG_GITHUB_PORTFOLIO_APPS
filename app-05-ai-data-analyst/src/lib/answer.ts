import type { AggregateFn, QueryPlan } from '../types'

const MEASURE: Record<AggregateFn, (field: string) => string> = {
  sum: (field) => `total ${field}`,
  avg: (field) => `average ${field}`,
  count: () => 'number of rows',
  min: (field) => `minimum ${field}`,
  max: (field) => `maximum ${field}`,
}

/**
 * The answer in one sentence, built from the engine's top group rather than from the model.
 * Digits use en-US so the sentence reads the same on every device.
 */
export function answerSentence(plan: QueryPlan, top: { label: string; value: number } | null): string | null {
  if (!top) return null
  const value = top.value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return `${top.label} has the highest ${MEASURE[plan.aggregate.fn](plan.aggregate.field)}: ${value}.`
}
