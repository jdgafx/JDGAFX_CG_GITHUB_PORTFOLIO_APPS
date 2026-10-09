import { answerDirection, isValueSort } from './queryPlan'
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
function measureWords(plan: QueryPlan): string {
  return MEASURE[plan.aggregate.fn](plan.aggregate.field)
}

/**
 * The answer in one sentence, built from the engine's top group rather than from the model.
 * It says "lowest" when the plan ranks the measure ascending, and "highest" otherwise. Digits use en-US so the sentence reads the same on every device.
 */
export function answerSentence(plan: QueryPlan, top: { label: string; value: number } | null): string | null {
  if (!top) return null
  const value = top.value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return `${top.label} has the ${answerDirection(plan)} ${measureWords(plan)}: ${value}.`
}

export interface ResultHeadline {
  /** The model's note that the data lacks what the question asked for. Null when it did not say so. */
  notice: string | null
  answer: string | null
  /** True when the notice is present: the chart answers a stand-in question, not the one asked. */
  substitute: boolean
}

/** What the result leads with: the notice first when there is one, then the computed sentence. */
export function describeResult(plan: QueryPlan, top: { label: string; value: number } | null): ResultHeadline {
  const notice = plan.notice ?? null
  return { notice, answer: answerSentence(plan, top), substitute: notice !== null }
}

interface PlanWords {
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
