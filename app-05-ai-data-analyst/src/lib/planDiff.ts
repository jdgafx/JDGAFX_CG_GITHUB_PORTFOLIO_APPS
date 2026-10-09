import { answerDirection, isValueSort, planFilters } from './queryPlan'
import { labelFor, RAW_VOCABULARY, withUnit } from './vocabulary'
import type { AggregateFn, FilterOp, HavingOp, PlanChange, PlanFilter, QueryPlan, Vocabulary } from '../types'

const FILTER_WORDS: Record<FilterOp, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is over',
  lt: 'is under',
  gte: 'is at least',
  lte: 'is at most',
  contains: 'contains',
}

const HAVING_WORDS: Record<HavingOp, string> = {
  gt: 'over',
  gte: 'at least',
  lt: 'under',
  lte: 'at most',
  eq: 'equal to',
  neq: 'other than',
}

const FN_WORDS: Record<AggregateFn, string> = {
  sum: 'total',
  avg: 'average',
  count: 'number of',
  min: 'minimum',
  max: 'maximum',
}

function filterText(filter: PlanFilter, vocab: Vocabulary): string {
  return `${labelFor(vocab, filter.field)} ${FILTER_WORDS[filter.op]} ${withUnit(vocab, filter.field, filter.value)}`
}

/** A test is the same test when column, comparison and value match, whatever the case. */
function filterKey(filter: PlanFilter): string {
  return `${filter.field}\u0000${filter.op}\u0000${filter.value.trim().toLowerCase()}`
}

function filterChanges(previous: QueryPlan, next: QueryPlan, vocab: Vocabulary): PlanChange[] {
  const before = planFilters(previous)
  const after = planFilters(next)
  const beforeKeys = new Set(before.map(filterKey))
  const afterKeys = new Set(after.map(filterKey))
  const added = after.filter((item) => !beforeKeys.has(filterKey(item)))
  const removed = before.filter((item) => !afterKeys.has(filterKey(item)))
  const changes: PlanChange[] = []

  // A test on the same column that moved to another value reads as one change, not a removal and an addition.
  for (const item of [...added]) {
    const old = removed.find((candidate) => candidate.field === item.field)
    if (!old) continue
    changes.push({ kind: 'filter', effect: 'changed', text: `Filter changed: ${filterText(old, vocab)} to ${filterText(item, vocab)}` })
    added.splice(added.indexOf(item), 1)
    removed.splice(removed.indexOf(old), 1)
  }
  for (const item of added) changes.push({ kind: 'filter', effect: 'added', text: `Filter added: ${filterText(item, vocab)}` })
  for (const item of removed) changes.push({ kind: 'filter', effect: 'removed', text: `Filter removed: ${filterText(item, vocab)}` })
  return changes
}

function measureText(plan: QueryPlan, vocab: Vocabulary): string {
  const { fn, field } = plan.aggregate
  return fn === 'count' ? `number of ${vocab.rowNoun}` : `${FN_WORDS[fn]} ${labelFor(vocab, field)}`
}

function sortText(plan: QueryPlan, vocab: Vocabulary): string {
  if (!plan.sortBy) return 'natural order'
  if (isValueSort(plan, plan.sortBy.field)) return answerDirection(plan) === 'lowest' ? 'lowest first' : 'highest first'
  return `${labelFor(vocab, plan.groupBy)} ${plan.sortBy.dir === 'asc' ? 'A to Z' : 'Z to A'}`
}

function havingText(plan: QueryPlan, vocab: Vocabulary): string | null {
  return plan.having ? `${measureText(plan, vocab)} ${HAVING_WORDS[plan.having.op]} ${plan.having.value}` : null
}

function limitText(plan: QueryPlan): string | null {
  return plan.limit === undefined ? null : `${answerDirection(plan) === 'lowest' ? 'bottom' : 'top'} ${plan.limit}`
}

/** Adds, replaces or removes one optional part of a plan, in the same words each time. */
function optional(
  kind: PlanChange['kind'],
  noun: string,
  before: string | null,
  after: string | null,
): PlanChange[] {
  if (before === after) return []
  if (before === null && after !== null) return [{ kind, effect: 'added', text: `${noun} added: ${after}` }]
  if (before !== null && after === null) return [{ kind, effect: 'removed', text: `${noun} removed: ${before}` }]
  return [{ kind, effect: 'changed', text: `${noun} changed: ${before} to ${after}` }]
}

/**
 * What a follow-up changed, as readable chips: filters, grouping, measure, chart type, sort, threshold
 * and group limit. Two plans that differ in nothing the page shows give one "Plan unchanged" chip.
 */
export function diffPlans(previous: QueryPlan, next: QueryPlan, vocab: Vocabulary = RAW_VOCABULARY): PlanChange[] {
  const changes: PlanChange[] = [...filterChanges(previous, next, vocab)]

  if (previous.groupBy !== next.groupBy) {
    changes.push({
      kind: 'group',
      effect: 'changed',
      text: `Grouped by ${labelFor(vocab, next.groupBy)} instead of ${labelFor(vocab, previous.groupBy)}`,
    })
  }
  const was = measureText(previous, vocab)
  const now = measureText(next, vocab)
  if (was !== now) changes.push({ kind: 'measure', effect: 'changed', text: `Measure changed: ${was} to ${now}` })
  if (previous.chartType !== next.chartType) {
    changes.push({ kind: 'chart', effect: 'changed', text: `Chart changed: ${previous.chartType} to ${next.chartType}` })
  }
  const sortBefore = sortText(previous, vocab)
  const sortAfter = sortText(next, vocab)
  if (sortBefore !== sortAfter) changes.push({ kind: 'sort', effect: 'changed', text: `Sort changed: ${sortBefore} to ${sortAfter}` })
  changes.push(...optional('having', 'Threshold', havingText(previous, vocab), havingText(next, vocab)))
  changes.push(...optional('limit', 'Limit', limitText(previous), limitText(next)))

  return changes.length > 0 ? changes : [{ kind: 'none', effect: 'same', text: 'Plan unchanged' }]
}
