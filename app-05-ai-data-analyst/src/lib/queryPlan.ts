import type { QueryPlan, ChartType, AggregateFn, FilterOp, SortDir } from '../types'

export const CHART_TYPES: ChartType[] = ['bar', 'line', 'pie', 'area', 'scatter']
export const AGGREGATE_FNS: AggregateFn[] = ['sum', 'avg', 'count', 'min', 'max']
export const FILTER_OPS: FilterOp[] = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains']
export const SORT_DIRS: SortDir[] = ['asc', 'desc']

/** Sort targets that always refer to the aggregated output rather than a source column. */
export const VALUE_SORT_FIELDS = ['value', 'count', 'total']

export type PlanValidation =
  | { ok: true; plan: QueryPlan }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
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

/**
 * Validates an LLM-produced query plan against the real dataset columns.
 * Runs on both sides of the wire: the function rejects with 422, the client
 * refuses to execute, so a hallucinated column can never render as a chart.
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
    if (!isRecord(raw.filter)) {
      return { ok: false, error: 'The AI returned an unreadable filter. Try rephrasing your question.' }
    }
    const filterField = str(raw.filter.field)
    const op = str(raw.filter.op)
    const value = typeof raw.filter.value === 'string' || typeof raw.filter.value === 'number'
      ? String(raw.filter.value)
      : null
    if (!filterField || !headers.includes(filterField)) {
      return { ok: false, error: unknownColumn('filter', filterField ?? 'missing', headers) }
    }
    if (!op || !FILTER_OPS.includes(op as FilterOp)) {
      return { ok: false, error: `The AI asked for an unsupported filter comparison ("${op ?? 'missing'}").` }
    }
    if (value === null) {
      return { ok: false, error: 'The AI returned a filter without a value. Try rephrasing your question.' }
    }
    plan.filter = { field: filterField, op: op as FilterOp, value }
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

  return { ok: true, plan }
}

/** True when the sort target refers to the aggregated value rather than the group label. */
export function isValueSort(plan: QueryPlan, field: string): boolean {
  if (field === plan.groupBy) return false
  return field === plan.aggregate.field || VALUE_SORT_FIELDS.includes(field.toLowerCase())
}
