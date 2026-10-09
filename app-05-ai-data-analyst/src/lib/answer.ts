import { topGroup } from './dataEngine'
import { answerDirection, asksBothEnds, isValueSort, planFilters } from './queryPlan'
import { labelFor, RAW_VOCABULARY, withUnit } from './vocabulary'
import type { AggregateFn, AnalysisResult, EngineResult, FilterOp, HavingOp, QueryPlan, TopGroup, Vocabulary } from '../types'

const MEASURE: Record<AggregateFn, (field: string, rowNoun: string) => string> = {
  sum: (field) => `total ${field}`,
  avg: (field) => `average ${field}`,
  count: (_field, rowNoun) => `number of ${rowNoun}`,
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

/** A measured value as text, with the unit of the column it was measured in. A count has no unit. */
function valueText(plan: QueryPlan, value: number, vocab: Vocabulary): string {
  const text = formatNumber(value)
  return plan.aggregate.fn === 'count' ? text : withUnit(vocab, plan.aggregate.field, text)
}

/** A column name as a plural noun: "month" -> "months", "category" -> "categories". */
function plural(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`
  return /(s|x|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`
}

/** " (2 of them tie with E at 8)" when the groups after the cut-off share the last shown value. */
function tieNote(labels: string[], values: number[], shown: number, plan: QueryPlan, vocab: Vocabulary): string {
  const last = values[shown - 1]
  if (shown >= values.length || last === undefined || values[shown] !== last) return ''
  const tying = values.slice(shown).filter((value) => value === last).length
  return ` (${tying} of them tie with ${labels[shown - 1]} at ${valueText(plan, last, vocab)})`
}

function namedGroups(result: EngineResult, plan: QueryPlan, vocab: Vocabulary, shown: number): string {
  const values = result.datasets[0]?.values ?? []
  return result.labels
    .slice(0, shown)
    .map((label, index) => `${label} (${valueText(plan, values[index] ?? 0, vocab)})`)
    .join(', ')
}

/**
 * The answer to a threshold question: how many groups meet it and which, or, when none does,
 * the value that came closest. Null when the plan has no threshold or no group existed at all.
 */
function havingSentence(plan: QueryPlan, result: EngineResult, vocab: Vocabulary): string | null {
  const { having } = plan
  const stats = result.having
  if (!having || !stats || stats.total === 0) return null
  const group = labelFor(vocab, plan.groupBy)
  const rule = `${measureWords(plan, vocab)} ${HAVING_WORDS[having.op]} ${valueText(plan, having.value, vocab)}`
  const count = result.labels.length

  if (count === 0) {
    const lower = having.op === 'lt' || having.op === 'lte'
    const closest = lower ? stats.lowest : stats.highest
    if (!closest) return null
    return `No ${group} has ${rule}. The ${lower ? 'lowest' : 'highest'} is ${valueText(plan, closest.value, vocab)} (${closest.label}).`
  }

  // A limit may have cut the list, so the count of groups that meet the rule is the pre-cut one.
  const meeting = result.limited?.total ?? count
  const values = result.datasets[0]?.values ?? []
  const named = namedGroups(result, plan, vocab, NAMED_GROUPS)
  const more = meeting > NAMED_GROUPS ? `, and ${meeting - NAMED_GROUPS} more` : ''
  const tie = count > NAMED_GROUPS ? tieNote(result.labels, values, NAMED_GROUPS, plan, vocab) : ''
  return `${meeting} ${meeting === 1 ? group : plural(group)} with ${rule}: ${named}${more}${tie}.`
}

/** The answer to "the top 5": the groups kept, and whether the cut-off split a tie. Null when nothing was cut. */
function limitSentence(plan: QueryPlan, result: EngineResult, vocab: Vocabulary): string | null {
  const { limited } = result
  if (plan.limit === undefined || !limited || result.labels.length === 0) return null
  const group = plural(labelFor(vocab, plan.groupBy))
  const end = answerDirection(plan) === 'lowest' ? 'Bottom' : 'Top'
  const named = namedGroups(result, plan, vocab, result.labels.length)
  const values = result.datasets[0]?.values ?? []
  const last = values[values.length - 1]
  const split =
    limited.tiedBeyond > 0 && last !== undefined
      ? ` ${limited.tiedBeyond} more ${limited.tiedBeyond === 1 ? 'has' : 'have'} the same ${valueText(plan, last, vocab)} and ${limited.tiedBeyond === 1 ? 'is' : 'are'} not shown.`
      : ''
  return `${end} ${result.labels.length} of ${limited.total} ${group} by ${measureWords(plan, vocab)}: ${named}.${split}`
}

/** The measure in words, such as "total revenue" or "number of earthquakes". */
export function measureWords(plan: QueryPlan, vocab: Vocabulary = RAW_VOCABULARY): string {
  return MEASURE[plan.aggregate.fn](labelFor(vocab, plan.aggregate.field), vocab.rowNoun)
}

const NAMED_TIES = 3

function tiedLabels(labels: string[]): string {
  const shown = labels.slice(0, NAMED_TIES).join(', ')
  const rest = labels.length - NAMED_TIES
  return rest > 0 ? `${shown}, and ${rest} more` : shown
}

/**
 * The answer in one sentence, built from the engine's top group rather than from the model.
 * It says "lowest" when the plan ranks the measure ascending, and "highest" otherwise, unless
 * `direction` names the end. When several groups share the value it says so instead of naming
 * one. Digits use en-US so the sentence reads the same on every device.
 */
export function answerSentence(
  plan: QueryPlan,
  top: TopGroup | null,
  vocab: Vocabulary = RAW_VOCABULARY,
  direction: 'highest' | 'lowest' = answerDirection(plan),
): string | null {
  if (!top) return null
  const rank = `${direction} ${measureWords(plan, vocab)}: ${valueText(plan, top.value, vocab)}`
  if (top.tied.length > 1) return `${top.tied.length} groups tie for the ${rank} (${tiedLabels(top.tied)}).`
  return `${top.label} has the ${rank}.`
}

export interface ResultOptions {
  vocab?: Vocabulary
  /** The question the result answers. A question that names both ends gets both answered. */
  question?: string
  /** The group with the lowest value, for a question that names both ends. */
  lowest?: TopGroup | null
  highest?: TopGroup | null
}

/** "Most and fewest" in one question: the highest group and the lowest group, one sentence each. */
function bothEndsSentence(
  plan: QueryPlan,
  result: EngineResult,
  vocab: Vocabulary,
  options: ResultOptions,
): string | null {
  if (!options.question || !asksBothEnds(options.question) || plan.having || plan.limit !== undefined) return null
  if (!options.highest || !options.lowest || result.labels.length < 2) return null
  const parts = [
    answerSentence(plan, options.highest, vocab, 'highest'),
    answerSentence(plan, options.lowest, vocab, 'lowest'),
  ]
  return parts.every((part): part is string => part !== null) ? parts.join(' ') : null
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
export function describeResult(
  plan: QueryPlan,
  top: TopGroup | null,
  result?: EngineResult,
  options: ResultOptions = {},
): ResultHeadline {
  const vocab = options.vocab ?? RAW_VOCABULARY
  const answer =
    (result && bothEndsSentence(plan, result, vocab, options)) ??
    (result && havingSentence(plan, result, vocab)) ??
    (result && limitSentence(plan, result, vocab)) ??
    answerSentence(plan, top, vocab)
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
  /** "Top 5" or "Bottom 3". Absent when the plan keeps every group. */
  limit?: string
  sort: string
}

/** The query plan in plain words, one phrase for each part the browser applies. */
export function describePlan(plan: QueryPlan, vocab: Vocabulary = RAW_VOCABULARY): PlanWords {
  const measure = measureWords(plan, vocab)
  const filters = planFilters(plan).map(
    (item) => `${labelFor(vocab, item.field)} ${FILTER_WORDS[item.op]} ${withUnit(vocab, item.field, item.value)}`,
  )
  const filter = filters.length > 0 ? filters.join(' and ') : 'None'

  let sort: string
  if (plan.sortBy) {
    const { field, dir } = plan.sortBy
    sort = isValueSort(plan, field)
      ? `${measure}, ${dir === 'asc' ? 'lowest first' : 'highest first'}`
      : `${labelFor(vocab, plan.groupBy)}, ${dir === 'asc' ? 'A to Z' : 'Z to A'}`
  } else if (plan.chartType === 'line' || plan.chartType === 'area') {
    sort = 'None, dates and numbers run in order'
  } else {
    sort = 'None, file order'
  }

  const having = plan.having
    ? `${measure} ${HAVING_WORDS[plan.having.op]} ${valueText(plan, plan.having.value, vocab)}`
    : null
  const words: PlanWords = { groupBy: labelFor(vocab, plan.groupBy), measure, filter, having, sort }
  if (plan.limit !== undefined) words.limit = `${answerDirection(plan) === 'lowest' ? 'Bottom' : 'Top'} ${plan.limit}`
  return words
}

/** The headline for a finished result: its question, its dataset's words and, for "most and fewest", both ends. */
export function headlineFor(result: AnalysisResult): ResultHeadline {
  const plan = result.queryPlan
  return describeResult(plan, topGroup(result, answerDirection(plan)), result, {
    vocab: result.vocab,
    question: result.question,
    highest: topGroup(result, 'highest'),
    lowest: topGroup(result, 'lowest'),
  })
}
