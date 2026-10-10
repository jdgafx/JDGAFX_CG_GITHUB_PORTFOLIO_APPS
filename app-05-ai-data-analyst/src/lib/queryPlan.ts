import type { QueryPlan, PlanFilter, ChartType, AggregateFn, FilterOp, HavingOp, ParsedData, SortDir, Vocabulary } from '../types'
import {
  asksForTotal,
  defaultGroup,
  countsRowsOfValue,
  GROUPING_WORDS,
  groupUnknownNoun,
  NO_VOCABULARY,
  namedColumn,
  namesGroups,
  planFilters,
  resolveCountColumn,
  ROWS,
  withMissingNoun,
  withoutRowNounFilter,
  withoutValueMissing,
  type QuestionNouns,
} from './questionNouns'
import { askedLimit, NUMBER_WORD_LIST } from './rankedCount'
import { RAW_VOCABULARY } from './vocabulary'

const CHART_TYPES: ChartType[] = ['bar', 'line', 'pie', 'area', 'scatter']
const AGGREGATE_FNS: AggregateFn[] = ['sum', 'avg', 'count', 'min', 'max']
const FILTER_OPS: FilterOp[] = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains']
const SORT_DIRS: SortDir[] = ['asc', 'desc']
const HAVING_OPS: HavingOp[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq']
const PLAIN_NUMBER = /^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?$/

/** The most missing items kept from a reply. */
const MAX_MISSING = 8

/** Row tests beyond the first one that a plan may carry. */
const MAX_MORE_FILTERS = 3
/** The most groups a plan may keep. A chart of more is unreadable, and the full result stays one export away. */
export const MAX_LIMIT = 1000
const MAX_REASON_CHARS = 300

/** Sort targets that always refer to the aggregated output rather than a source column. */
const VALUE_SORT_FIELDS = ['value', 'count', 'total']

type PlanValidation =
  | { ok: true; plan: QueryPlan }
  | { ok: false; error: string }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function unknownColumn(role: string, name: string, headers: string[]): string {
  const shown = headers.slice(0, 12).join(', ')
  const more = headers.length > 12 ? `, and ${headers.length - 12} more` : ''
  return `The AI picked a ${role} column ("${name}") that is not in this dataset. Available columns: ${shown}${more}. Try naming the column you want in your question.`
}

type FilterRead = { ok: true; value: PlanFilter } | { ok: false; error: string }

/** One row test from a reply. The column must exist, the comparison must be known, and a value must be present. */
function readFilter(raw: unknown, headers: string[]): FilterRead {
  if (!isRecord(raw)) {
    return { ok: false, error: 'The AI returned an unreadable filter. Try rephrasing your question.' }
  }
  const field = str(raw.field)
  const op = str(raw.op)
  const value = typeof raw.value === 'string' || typeof raw.value === 'number' ? String(raw.value) : null
  if (!field || !headers.includes(field)) {
    return { ok: false, error: unknownColumn('filter', field ?? 'missing', headers) }
  }
  if (!op || !FILTER_OPS.includes(op as FilterOp)) {
    return { ok: false, error: `The AI asked for an unsupported filter comparison ("${op ?? 'missing'}").` }
  }
  if (value === null) {
    return { ok: false, error: 'The AI returned a filter without a value. Try rephrasing your question.' }
  }
  return { ok: true, value: { field, op: op as FilterOp, value } }
}

export { planFilters }

/**
 * Validates an LLM-produced query plan against the real dataset columns.
 * Runs on both sides of the wire: the function repairs a rejected plan once and
 * then answers 422, and the client refuses to execute, so a hallucinated column
 * can never render as a chart.
 */
export function validateQueryPlan(raw: unknown, headers: string[]): PlanValidation {
  if (!isRecord(raw)) {
    return { ok: false, error: 'The AI returned an unreadable response. Try rephrasing your question.' }
  }

  const chartType = str(raw.chartType)
  if (!chartType || !CHART_TYPES.includes(chartType as ChartType)) {
    return { ok: false, error: `The AI asked for an unsupported chart type ("${chartType ?? 'missing'}").` }
  }

  const counted = str(raw.countColumn)
  const countColumn = counted !== null && counted.toLowerCase() !== 'null' ? counted : null
  const total = countColumn?.toLowerCase() === ROWS
  let groupBy = str(raw.groupBy)
  // A count names its own column, and a total has no groups, so a missing or unknown group column is replaced by a
  // placeholder. The browser settles which column the count names (applyCountColumn, called from analysis.ts); this check
  // runs on both sides and only keeps the choice.
  if (countColumn !== null && (!groupBy || !headers.includes(groupBy))) groupBy = headers[0] ?? null
  if (!groupBy) {
    return { ok: false, error: 'The AI did not say which column to group by. Try rephrasing your question.' }
  }
  if (!headers.includes(groupBy)) {
    return { ok: false, error: unknownColumn('group-by', groupBy, headers) }
  }

  if (!isRecord(raw.aggregate)) {
    return { ok: false, error: 'The AI did not say what to measure. Try rephrasing your question.' }
  }
  const fn = str(raw.aggregate.fn)
  if (!fn || !AGGREGATE_FNS.includes(fn as AggregateFn)) {
    return { ok: false, error: `The AI asked for an unsupported calculation ("${fn ?? 'missing'}").` }
  }
  let field = str(raw.aggregate.field)
  if (fn === 'count') {
    // count ignores the field value, so a placeholder like "*" is harmless — pin it to a real column.
    if (!field || !headers.includes(field)) field = groupBy
  } else if (!field) {
    return { ok: false, error: 'The AI did not say which column to measure. Try rephrasing your question.' }
  } else if (!headers.includes(field)) {
    return { ok: false, error: unknownColumn('measured', field, headers) }
  }

  const plan: QueryPlan = {
    chartType: chartType as ChartType,
    groupBy,
    aggregate: { field, fn: fn as AggregateFn },
    title: str(raw.title) ?? 'Result',
    explanation: str(raw.explanation) ?? '',
    ...(countColumn !== null ? { countColumn: total ? ROWS : countColumn } : {}),
  }

  if (raw.filter !== undefined && raw.filter !== null) {
    const filter = readFilter(raw.filter, headers)
    if (!filter.ok) return filter
    plan.filter = filter.value
  }

  if (raw.moreFilters !== undefined && raw.moreFilters !== null) {
    if (!Array.isArray(raw.moreFilters)) {
      return { ok: false, error: 'The AI returned an unreadable list of filters. Try rephrasing your question.' }
    }
    const more: PlanFilter[] = []
    for (const item of raw.moreFilters.slice(0, MAX_MORE_FILTERS)) {
      const filter = readFilter(item, headers)
      if (!filter.ok) return filter
      more.push(filter.value)
    }
    // A further test only makes sense beside a first one, so it is promoted when `filter` is absent.
    if (!plan.filter) plan.filter = more.shift()
    if (more.length > 0) plan.moreFilters = more
  }

  if (raw.sortBy !== undefined && raw.sortBy !== null) {
    if (!isRecord(raw.sortBy)) {
      return { ok: false, error: 'The AI returned an unreadable sort. Try rephrasing your question.' }
    }
    const sortField = str(raw.sortBy.field)
    const dir = str(raw.sortBy.dir) ?? 'desc'
    if (!SORT_DIRS.includes(dir as SortDir)) {
      return { ok: false, error: `The AI asked for an unsupported sort direction ("${dir}").` }
    }
    if (!sortField) {
      return { ok: false, error: 'The AI returned a sort without a column. Try rephrasing your question.' }
    }
    // A chart can only be sorted by what it plots: the group labels or the aggregated value.
    const sortable =
      sortField === plan.groupBy ||
      sortField === plan.aggregate.field ||
      VALUE_SORT_FIELDS.includes(sortField.toLowerCase())
    if (!sortable) {
      return {
        ok: false,
        error: `The AI tried to sort by "${sortField}", which is not shown in this chart. Sort by "${plan.groupBy}" or "${plan.aggregate.field}" instead.`,
      }
    }
    plan.sortBy = { field: sortField, dir: dir as SortDir }
  }

  if (raw.having !== undefined && raw.having !== null) {
    if (!isRecord(raw.having)) {
      return { ok: false, error: 'The AI returned an unreadable threshold. Try rephrasing your question.' }
    }
    const op = str(raw.having.op)
    const text = typeof raw.having.value === 'string' ? raw.having.value.replace(/,/g, '').trim() : raw.having.value
    const value = typeof text === 'number' ? text : typeof text === 'string' && PLAIN_NUMBER.test(text) ? Number(text) : NaN
    if (!op || !HAVING_OPS.includes(op as HavingOp)) {
      return { ok: false, error: `The AI asked for an unsupported threshold comparison ("${op ?? 'missing'}").` }
    }
    if (!Number.isFinite(value)) {
      return { ok: false, error: 'The AI returned a threshold without a number. Try rephrasing your question.' }
    }
    plan.having = { op: op as HavingOp, value }
  }

  if (raw.limit !== undefined && raw.limit !== null) {
    const limit = typeof raw.limit === 'string' && PLAIN_NUMBER.test(raw.limit.trim()) ? Number(raw.limit) : raw.limit
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return { ok: false, error: `The AI asked to keep a number of groups that is not between 1 and ${MAX_LIMIT}. Try rephrasing your question.` }
    }
    plan.limit = limit
  }

  if (total) makeTotal(plan)

  if (raw.missing !== undefined && raw.missing !== null) {
    if (!Array.isArray(raw.missing) || !raw.missing.every((item) => typeof item === 'string')) {
      return { ok: false, error: 'The AI returned an unreadable list of missing items. Try rephrasing your question.' }
    }
    const missing = raw.missing.map((item: string) => item.trim()).filter((item) => item !== '').slice(0, MAX_MISSING)
    if (missing.length > 0) plan.missing = missing
  }

  const cannotApply = str(raw.cannotApply)
  if (cannotApply && cannotApply.toLowerCase() !== 'null') plan.cannotApply = cannotApply.slice(0, MAX_REASON_CHARS)

  const notice = str(raw.notice)
  if (notice && notice.toLowerCase() !== 'null') plan.notice = notice

  // The model's own report that the question has nothing to do with this dataset. Only a "false" is kept. Anything else
  // (true, absent, unreadable) leaves the question answerable, so a reply that forgets the field never blocks a real question.
  // A reply that also lists something the data lacks ("coast") contradicts itself: it understood what the question is about,
  // so the stand-in chart and its notice stand and the question is not refused.
  const offSubject = raw.aboutData === false || (typeof raw.aboutData === 'string' && raw.aboutData.trim().toLowerCase() === 'false')
  if (offSubject && plan.missing === undefined) plan.aboutData = false

  return { ok: true, plan }
}

/** True when the plan is one total over all the rows that pass the filters, with no groups. */
export function isTotal(plan: QueryPlan): boolean {
  return plan.countColumn === ROWS
}

/**
 * Makes the plan one total: a single bar. A total is one group, so a threshold, a limit or a sort has nothing to act
 * on. Dropping them keeps a stray one from filtering the only group away and blanking the total.
 */
function makeTotal(plan: QueryPlan): void {
  plan.countColumn = ROWS
  plan.chartType = 'bar'
  delete plan.having
  delete plan.limit
  delete plan.sortBy
}

/** True when the sort target refers to the aggregated value rather than the group label. */
export function isValueSort(plan: QueryPlan, field: string): boolean {
  if (field === plan.groupBy) return false
  return field === plan.aggregate.field || VALUE_SORT_FIELDS.includes(field.toLowerCase())
}

/**
 * Which end of the ranking the one-sentence answer reports. A plan that sorts the measured
 * value ascending asks for the lowest group; every other plan reports the highest.
 */
export function answerDirection(plan: QueryPlan): 'highest' | 'lowest' {
  return plan.sortBy && isValueSort(plan, plan.sortBy.field) && plan.sortBy.dir === 'asc' ? 'lowest' : 'highest'
}

const LOWEST_WORDS = /\b(lowest|least|fewest|smallest|coldest|bottom)\b/i
const HIGHEST_WORDS = /\b(highest|most|largest|biggest|greatest|hottest|warmest|top)\b/i
/** "at least 5" and "at most 5" are thresholds, not rankings. */
const THRESHOLD_PHRASE = /\bat (least|most)\b/gi

/**
 * Which end of the ranking the question asks for, read from its wording. Null when it names
 * neither end or both. "Minimum" and "maximum" are left out: in "minimum temperature by month"
 * they name the calculation, not a ranking.
 */
export function askedDirection(question: string): 'highest' | 'lowest' | null {
  const text = question.replace(THRESHOLD_PHRASE, ' ')
  const lowest = LOWEST_WORDS.test(text)
  const highest = HIGHEST_WORDS.test(text)
  if (lowest === highest) return null
  return lowest ? 'lowest' : 'highest'
}

const LIMIT_WORDS = new RegExp(`\\b(top|bottom|first|last|best|worst|\\d+|${NUMBER_WORD_LIST})\\b`, 'i')

/**
 * A model sometimes sets "limit: 1" for "which region had the fewest?", which would draw a single bar.
 * A limit is kept only when it is the one the plan already had, or the question names a number or an
 * end of the ranking ("top 5", "the 3 coldest", "first ten"). Otherwise the chart keeps every group.
 */
export function dropUnaskedLimit(plan: QueryPlan, question: string, previousLimit?: number): QueryPlan {
  if (plan.limit === undefined || plan.limit === previousLimit || LIMIT_WORDS.test(question)) return plan
  const kept = { ...plan }
  delete kept.limit
  return kept
}

/** The field a chart's value sort names. A count of the grouping column itself has no value field of its own, so it sorts by 'count'. */
function valueSortField(plan: QueryPlan): string {
  return plan.aggregate.fn === 'count' && plan.aggregate.field === plan.groupBy ? 'count' : plan.aggregate.field
}

/**
 * Makes a grouped plan keep the groups the question asks for. The model often leaves `limit` out of "Top 3 regions", and
 * the browser only ever removed a limit, so every group was drawn. A plan with no limit gets the count the question names,
 * sorted by the measure so the kept groups are the highest ("top", "first") or the lowest ("bottom", "last"). A limit the
 * model set with no sort at all would keep arbitrary groups, so it is ranked the same way. A limit with a sort of the
 * model's own (even by the group name), a total, and a line or area chart (which keep their natural order) are left alone.
 */
export function applyQuestionLimit(plan: QueryPlan, question: string): QueryPlan {
  if (isTotal(plan) || plan.chartType === 'line' || plan.chartType === 'area') return plan
  if (plan.limit !== undefined && plan.sortBy !== undefined) return plan
  const asked = askedLimit(question)
  if (!asked || asked.count < 1 || asked.count > MAX_LIMIT) return plan
  const sortBy =
    plan.sortBy && isValueSort(plan, plan.sortBy.field) && plan.sortBy.dir === asked.dir
      ? plan.sortBy
      : { field: valueSortField(plan), dir: asked.dir }
  return { ...plan, limit: plan.limit ?? asked.count, sortBy }
}

/** True when the question asks for both ends at once: "the most and the fewest earthquakes". */
export function asksBothEnds(question: string): boolean {
  const text = question.replace(THRESHOLD_PHRASE, ' ')
  return LOWEST_WORDS.test(text) && HIGHEST_WORDS.test(text)
}

/**
 * Makes the plan's ranking follow the question, not the model's sort choice. When the question
 * asks for the lowest or the highest group, the measure is sorted that way, replacing a sort by
 * the group name or the opposite direction. Line and area charts keep their natural order, and a
 * question that asks for neither end leaves the plan alone.
 */
export function applyQuestionDirection(plan: QueryPlan, question: string): QueryPlan {
  const asked = askedDirection(question)
  if (!asked || isTotal(plan) || plan.chartType === 'line' || plan.chartType === 'area') return plan
  if (answerDirection(plan) === asked && plan.sortBy && isValueSort(plan, plan.sortBy.field)) return plan
  return { ...plan, sortBy: { field: valueSortField(plan), dir: asked === 'lowest' ? 'asc' : 'desc' } }
}

/**
 * Makes the plan answer a total question with a total. A model sometimes groups "in total, how many earthquakes
 * had magnitude 4.5 or greater?" by region, and the answer then names the top region instead of the count.
 * A question that asks for one number and names no grouping becomes an ungrouped plan. This holds for a follow-up
 * too: "in total, how many had magnitude 5 or greater?" after a grouped result gives the one count. The threshold,
 * limit and sort go, since one total has no groups for them to act on. A plan whose countColumn the model chose and
 * the server resolved is left as it is: the question's words only decide when the model did not.
 */
export function applyQuestionTotal(plan: QueryPlan, question: string, names: QuestionNouns = NO_VOCABULARY): QueryPlan {
  if (plan.countColumn !== undefined || !asksForTotal(question, names)) return plan
  const total: QueryPlan = {
    ...plan,
    title: 'Overall total',
    explanation: 'Every row that passes the filters is counted together, not split into groups.',
  }
  makeTotal(total)
  return total
}

/**
 * Settles what the model's countColumn names in this dataset, so the headline counts the right thing:
 * - "rows", or a word for the rows ("quakes"), is one total over the rows;
 * - a header, label or "earthquake types" for "event type" counts that column's groups, and groups by it;
 * - anything else is a noun the data lacks: `missing` names it, a notice says so, and no filter tests for it.
 * A ranking, breakdown or comparison in the question is never a total or a count of one column. A "rows" choice is
 * also taken back when the question counts a column, or counts a noun the data lacks and the plan does not filter on
 * it as a value found in the rows ("hit Japan" with region = Japan stays a total; "tremors" with type = tremor, which
 * finds no row, does not). A plan with no countColumn falls back to the question's own words, as for a model that
 * sent none. A missing item that is a value the plan filters on and finds in the rows is dropped: "Japan" is a place.
 */
export function applyCountColumn(
  asked: QueryPlan,
  question: string,
  names: QuestionNouns = NO_VOCABULARY,
  rows: ParsedData['rows'] = [],
  vocab: Vocabulary = RAW_VOCABULARY,
): QueryPlan {
  const plan = withoutValueMissing(withoutRowNounFilter(asked, question, names, rows), rows, question, names)
  if (plan.countColumn === undefined) {
    if (!countsRowsOfValue(question, names, plan, rows)) return groupUnknownNoun(plan, question, names, rows, vocab)
    const total: QueryPlan = { ...plan }
    makeTotal(total)
    return total
  }
  const rest: QueryPlan = { ...plan }
  delete rest.countColumn
  const target = resolveCountColumn(plan.countColumn, names)
  if (target.kind === 'unknown') return withMissingNoun(rest, target.noun, names, rows, vocab)
  const column = namedColumn(question, names)
  // A total on a question that counts groups or names a grouping is taken back. A total's groupBy is only a placeholder,
  // so the plan groups by the column the question names, else by the vocabulary's default column. A question with a
  // grouping word ("per magnitude type") keeps the grouping the model picked, which is then a real choice.
  if (target.kind === 'rows' && namesGroups(question, names, rest, rows)) {
    const ranked = GROUPING_WORDS.test(question.replace(/\bat (least|most)\b/gi, ' '))
    const groupBy = column ?? (ranked ? rest.groupBy : (defaultGroup(names, vocab) ?? rest.groupBy))
    return groupUnknownNoun({ ...rest, groupBy }, question, names, rows, vocab)
  }
  if (GROUPING_WORDS.test(question.replace(/\bat (least|most)\b/gi, ' '))) return groupUnknownNoun(rest, question, names, rows, vocab)
  // A noun the data lacks that the model mapped to a nearby column ("cities" to place) still gets the notice.
  if (target.kind === 'column') return groupUnknownNoun({ ...rest, countColumn: target.header, groupBy: target.header }, question, names, rows, vocab)
  const total: QueryPlan = { ...rest }
  makeTotal(total)
  return total
}
