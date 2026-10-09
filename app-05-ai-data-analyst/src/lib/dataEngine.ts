import Papa from 'papaparse'
import type { HavingOp, HavingStats, ParsedData, PlanFilter, QueryPlan, EngineResult, TopGroup } from '../types'
import { isValueSort, planFilters } from './queryPlan'
import { MAX_ROWS } from './limits'

const BLANK_LABEL = '(blank)'

/** Currency symbols, thousands separators, percent signs and stray spaces seen in real CSV exports. */
const NUMERIC_NOISE = /[$€£¥₹,%\s]/g
const NUMERIC_SHAPE = /^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?$/
const DATE_SHAPE = /^\d{4}-\d{1,2}(-\d{1,2})?([T ]|$)|^\d{1,2}\/\d{1,2}\/\d{2,4}$/

/**
 * Parses a spreadsheet-style numeric cell: "$1,234.56" -> 1234.56, "(500)" -> -500,
 * "45%" -> 45. Returns null for anything that is not a number, so callers can
 * count and report skipped cells instead of silently treating them as zero.
 */
export function parseNumericCell(raw: string | undefined | null): number | null {
  if (raw == null) return null
  let text = raw.trim()
  if (text === '') return null

  let negative = false
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true
    text = text.slice(1, -1)
  }

  text = text.replace(NUMERIC_NOISE, '')
  if (text === '' || !NUMERIC_SHAPE.test(text)) return null

  const value = Number(text)
  if (!Number.isFinite(value)) return null
  return negative ? -value : value
}

export function parseCSV(csvString: string): ParsedData {
  const result = Papa.parse<Record<string, string>>(csvString, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
    transform: (v: string) => v.trim(),
  })

  if (result.errors.length > 0 && (!result.data || result.data.length === 0)) {
    throw new Error(
      'This file could not be read as CSV. Check that it has a header row and comma-separated values.',
    )
  }

  const headers = result.meta.fields ?? []
  if (headers.length === 0) {
    throw new Error('CSV has no columns. Check that the file contains a header row.')
  }

  const rows = result.data.length > MAX_ROWS
    ? result.data.slice(0, MAX_ROWS)
    : result.data

  // Papa reports one entry per malformed cell/field; count the distinct rows they touch.
  const parseErrorRowCount = new Set(
    result.errors.filter((e) => typeof e.row === 'number').map((e) => e.row),
  ).size

  return {
    headers,
    rows,
    truncated: result.data.length > MAX_ROWS,
    totalRows: result.data.length,
    parseErrorRowCount,
  }
}

function meets(value: number, op: HavingOp, limit: number): boolean {
  switch (op) {
    case 'gt':
      return value > limit
    case 'gte':
      return value >= limit
    case 'lt':
      return value < limit
    case 'lte':
      return value <= limit
    case 'eq':
      return value === limit
    case 'neq':
      return value !== limit
  }
}

function havingStats(labels: string[], values: number[]): HavingStats {
  let high = -1
  let low = -1
  values.forEach((value, index) => {
    if (high === -1 || value > (values[high] ?? 0)) high = index
    if (low === -1 || value < (values[low] ?? 0)) low = index
  })
  const at = (index: number) => (index === -1 ? null : { label: labels[index] ?? '', value: values[index] ?? 0 })
  return { total: labels.length, highest: at(high), lowest: at(low) }
}

function labelComparator(labels: string[]): ((a: string, b: string) => number) | null {
  if (labels.length < 2) return null
  if (labels.every((l) => DATE_SHAPE.test(l) && !Number.isNaN(Date.parse(l)))) {
    return (a, b) => Date.parse(a) - Date.parse(b)
  }
  if (labels.every((l) => parseNumericCell(l) !== null)) {
    return (a, b) => (parseNumericCell(a) ?? 0) - (parseNumericCell(b) ?? 0)
  }
  return null
}

function applyOrder(
  labels: string[],
  values: number[],
  compare: (a: { label: string; value: number }, b: { label: string; value: number }) => number,
) {
  const pairs = labels.map((label, i) => ({ label, value: values[i] ?? 0 }))
  pairs.sort(compare)
  labels.length = 0
  values.length = 0
  for (const p of pairs) {
    labels.push(p.label)
    values.push(p.value)
  }
}

/** True when the row meets one test. Number comparisons need a number on both sides. */
function rowPasses(row: Record<string, string>, { field, op, value }: PlanFilter): boolean {
  const cellValue = row[field] ?? ''
  const numValue = parseNumericCell(value)
  const numCell = parseNumericCell(cellValue)
  const comparable = numCell !== null && numValue !== null
  switch (op) {
    case 'eq':
      return cellValue.toLowerCase() === value.toLowerCase()
    case 'neq':
      return cellValue.toLowerCase() !== value.toLowerCase()
    case 'gt':
      return comparable && numCell > numValue
    case 'lt':
      return comparable && numCell < numValue
    case 'gte':
      return comparable && numCell >= numValue
    case 'lte':
      return comparable && numCell <= numValue
    case 'contains':
      return cellValue.toLowerCase().includes(value.toLowerCase())
  }
}

/** Runs a plan over every row. The plan must already have passed validateQueryPlan for these headers. */
export function executeQuery(data: ParsedData, plan: QueryPlan): EngineResult {
  let rows = [...data.rows]

  for (const filter of planFilters(plan)) rows = rows.filter((row) => rowPasses(row, filter))

  const groups = new Map<string, number[]>()
  let skippedCells = 0

  for (const row of rows) {
    const rawKey = row[plan.groupBy]
    const key = rawKey == null || rawKey.trim() === '' ? BLANK_LABEL : rawKey

    if (!groups.has(key)) groups.set(key, [])

    if (plan.aggregate.fn === 'count') {
      groups.get(key)?.push(1)
      continue
    }

    const parsed = parseNumericCell(row[plan.aggregate.field])
    if (parsed === null) {
      skippedCells += 1
      continue
    }
    groups.get(key)?.push(parsed)
  }

  const labels: string[] = []
  const values: number[] = []

  for (const [label, nums] of groups) {
    labels.push(label)
    const total = nums.reduce((a, b) => a + b, 0)
    let agg: number
    switch (plan.aggregate.fn) {
      case 'sum':
        agg = total
        break
      case 'avg':
        agg = nums.length > 0 ? total / nums.length : 0
        break
      case 'count':
        agg = nums.length
        break
      case 'min':
        agg = nums.length > 0 ? Math.min(...nums) : 0
        break
      case 'max':
        agg = nums.length > 0 ? Math.max(...nums) : 0
        break
    }
    values.push(agg)
  }

  let having: HavingStats | undefined
  if (plan.having) {
    const { op, value: limit } = plan.having
    having = havingStats(labels, values)
    const kept = labels
      .map((label, index) => ({ label, value: values[index] ?? 0 }))
      .filter((group) => meets(group.value, op, limit))
    labels.length = 0
    values.length = 0
    for (const group of kept) {
      labels.push(group.label)
      values.push(group.value)
    }
  }

  if (plan.sortBy) {
    const { field, dir } = plan.sortBy
    const byValue = isValueSort(plan, field)
    applyOrder(labels, values, (a, b) => {
      if (byValue) return dir === 'asc' ? a.value - b.value : b.value - a.value
      return dir === 'asc' ? a.label.localeCompare(b.label) : b.label.localeCompare(a.label)
    })
  } else if (plan.chartType === 'line' || plan.chartType === 'area') {
    // Continuous charts read as a sequence — file order turns a time series into a zigzag.
    const compare = labelComparator(labels)
    if (compare) applyOrder(labels, values, (a, b) => compare(a.label, b.label))
  }

  let limited: EngineResult['limited']
  if (plan.limit !== undefined && labels.length > plan.limit) {
    const lastKept = values[plan.limit - 1]
    limited = { total: labels.length, tiedBeyond: values.slice(plan.limit).filter((value) => value === lastKept).length }
    labels.length = plan.limit
    values.length = plan.limit
  }

  const warnings: string[] = []
  if (skippedCells > 0) {
    const noun = skippedCells === 1 ? 'cell' : 'cells'
    warnings.push(
      `Column "${plan.aggregate.field}": ${skippedCells.toLocaleString()} non-numeric ${noun} ignored.`,
    )
  }

  return {
    labels,
    datasets: [{ name: plan.aggregate.field, values }],
    warnings,
    ...(having ? { having } : {}),
    ...(limited ? { limited } : {}),
  }
}

/** The group with the largest (or smallest) value, read from the full result before any chart limiting. */
export function topGroup(
  result: EngineResult,
  direction: 'highest' | 'lowest' = 'highest',
): TopGroup | null {
  const values = result.datasets[0]?.values ?? []
  const beats = (a: number, b: number) => (direction === 'highest' ? a > b : a < b)
  let best = -1
  values.forEach((value, index) => {
    if (best === -1 || beats(value, values[best] ?? 0)) best = index
  })
  if (best === -1) return null
  const value = values[best] ?? 0
  // The best index is the first one holding this value, so the top group leads the tied list.
  const tied = result.labels.filter((_, index) => values[index] === value)
  return { label: result.labels[best] ?? '', value, tied }
}
