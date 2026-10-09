import { answerDirection, isValueSort } from './queryPlan'
import type { AggregateFn, EngineResult, FilterOp, HavingOp, QueryPlan, TopGroup } from '../types'

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

const HAVING_WORDS: Record<HavingOp, string> = {
  gt: 'above',
  gte: 'of at least',
  lt: 'below',
  lte: 'of at most',
  eq: 'equal to',
  neq: 'other than',
}

const NAMED_GROUPS = 5

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** A column name as a plural noun: "month" -> "months", "category" -> "categories". */
function plural(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`
  return /(s|x|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`
}

/**
 * The answer to a threshold question: how many groups meet it and which, or, when none does,
 * the value that came closest. Null when the plan has no threshold or no group existed at all.
 */
function havingSentence(plan: QueryPlan, result: EngineResult): string | null {
  const { having } = plan
  const stats = result.having
  if (!having || !stats || stats.total === 0) return null
  const rule = `${measureWords(plan)} ${HAVING_WORDS[having.op]} ${formatNumber(having.value)}`
  const count = result.labels.length

  if (count === 0) {
    const lower = having.op === 'lt' || having.op === 'lte'
    const closest = lower ? stats.lowest : stats.highest
    if (!closest) return null
    return `No ${plan.groupBy} has ${rule}. The ${lower ? 'lowest' : 'highest'} is ${formatNumber(closest.value)} (${closest.label}).`
  }

  const values = result.datasets[0]?.values ?? []
  const named = result.labels
    .slice(0, NAMED_GROUPS)
    .map((label, index) => `${label} (${formatNumber(values[index] ?? 0)})`)
    .join(', ')
  const more = count > NAMED_GROUPS ? `, and ${count - NAMED_GROUPS} more` : ''
  return `${count} ${count === 1 ? plan.groupBy : plural(plan.groupBy)} with ${rule}: ${named}${more}.`
}

/** The measure in words, such as "total revenue" or "number of rows". */
function measureWords(plan: QueryPlan): string {
  return MEASURE[plan.aggregate.fn](plan.aggregate.field)
}

const NAMED_TIES = 3

function tiedLabels(labels: string[]): string {
  const shown = labels.slice(0, NAMED_TIES).join(', ')
  const rest = labels.length - NAMED_TIES
  return rest > 0 ? `${shown}, and ${rest} more` : shown
}

/**
 * The answer in one sentence, built from the engine's top group rather than from the model.
 * It says "lowest" when the plan ranks the measure ascending, and "highest" otherwise. When
 * several groups share the value it says so instead of naming one. Digits use en-US so the
 * sentence reads the same on every device.
 */
export function answerSentence(plan: QueryPlan, top: TopGroup | null): string | null {
  if (!top) return null
  const value = top.value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  const rank = `${answerDirection(plan)} ${measureWords(plan)}: ${value}`
  if (top.tied.length > 1) return `${top.tied.length} groups tie for the ${rank} (${tiedLabels(top.tied)}).`
  return `${top.label} has the ${rank}.`
}

export interface ResultHeadline {
  /** Leads the result when the data lacks what the question named. Null otherwise. */
  notice: string | null
  /** The model's plain remark, shown low on the page. Null when it is empty or already the lead. */
  note: string | null
  answer: string | null
  /** True when the plan lists missing items: the chart answers a stand-in question, not the one asked. */
  substitute: boolean
}

/**
 * What the result leads with. Only a non-empty `missing` list marks a stand-in. Its notice
 * (or a line built from the list) leads; a remark without missing items stays a plain note.
 */
export function describeResult(plan: QueryPlan, top: TopGroup | null, result?: EngineResult): ResultHeadline {
  const answer = (result && havingSentence(plan, result)) ?? answerSentence(plan, top)
  if (plan.missing) {
    return {
      notice: plan.notice ?? `The data has no column for: ${plan.missing.join(', ')}.`,
      note: null,
      answer,
      substitute: true,
    }
  }
  return { notice: null, note: plan.notice ?? null, answer, substitute: false }
}

interface PlanWords {
  groupBy: string
  measure: string
  filter: string
  /** The threshold on the aggregated value. Null when the plan has none. */
  having: string | null
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

  const having = plan.having ? `${measure} ${HAVING_WORDS[plan.having.op]} ${formatNumber(plan.having.value)}` : null

  return { groupBy: plan.groupBy, measure, filter, having, sort }
}
