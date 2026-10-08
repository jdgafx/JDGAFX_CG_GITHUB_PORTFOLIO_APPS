import { isValueSort } from './queryPlan'
import type { AggregateFn, FilterOp, QueryPlan } from '../types'

const MEASURE: Record<AggregateFn, (field: string) => string> = {
  sum: (field) => `total ${field}`,
  avg: (field) => `average ${field}`,
  count: () => 'number of rows',
  min: (field) => `minimum ${field}`,
  max: (field) => `maximum ${field}`,
}

const FILTER_WORDS: Record<FilterOp, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is greater than',
  lt: 'is less than',
  gte: 'is at least',
  lte: 'is at most',
  contains: 'contains',
}

/** The measure in words, such as "total revenue" or "number of rows". */
export function measureWords(plan: QueryPlan): string {
  return MEASURE[plan.aggregate.fn](plan.aggregate.field)
}

/**
 * The answer in one sentence, built from the engine's top group rather than from the model.
 * Digits use en-US so the sentence reads the same on every device.
 */
export function answerSentence(plan: QueryPlan, top: { label: string; value: number } | null): string | null {
  if (!top) return null
  const value = top.value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return `${top.label} has the highest ${measureWords(plan)}: ${value}.`
}

export interface PlanWords {
  groupBy: string
  measure: string
  filter: string
  sort: string
}

/** The query plan in plain words, one phrase for each part the browser applies. */
export function describePlan(plan: QueryPlan): PlanWords {
  const measure = measureWords(plan)
  const filter = plan.filter ? `${plan.filter.field} ${FILTER_WORDS[plan.filter.op]} ${plan.filter.value}` : 'None'

  let sort: string
  if (plan.sortBy) {
    const { field, dir } = plan.sortBy
    sort = isValueSort(plan, field)
      ? `${measure}, ${dir === 'asc' ? 'lowest first' : 'highest first'}`
      : `${plan.groupBy}, ${dir === 'asc' ? 'A to Z' : 'Z to A'}`
  } else if (plan.chartType === 'line' || plan.chartType === 'area') {
    sort = 'None, dates and numbers run in order'
  } else {
    sort = 'None, file order'
  }

  return { groupBy: plan.groupBy, measure, filter, sort }
}
