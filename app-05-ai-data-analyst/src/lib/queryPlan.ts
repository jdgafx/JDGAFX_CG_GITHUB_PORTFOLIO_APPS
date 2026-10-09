import type { QueryPlan, PlanFilter, ChartType, AggregateFn, FilterOp, HavingOp, SortDir } from '../types'

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

/** Every row test of a plan, the first one and the further ones. */
export function planFilters(plan: QueryPlan): PlanFilter[] {
  return [...(plan.filter ? [plan.filter] : []), ...(plan.moreFilters ?? [])]
}

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

  const groupBy = str(raw.groupBy)
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

  return { ok: true, plan }
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

const LIMIT_WORDS = /\b(top|bottom|first|last|best|worst|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i

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
  if (!asked || plan.chartType === 'line' || plan.chartType === 'area') return plan
  if (answerDirection(plan) === asked && plan.sortBy && isValueSort(plan, plan.sortBy.field)) return plan
  return { ...plan, sortBy: { field: plan.aggregate.field, dir: asked === 'lowest' ? 'asc' : 'desc' } }
}
