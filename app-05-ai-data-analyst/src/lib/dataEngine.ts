import Papa from 'papaparse'
import type { ParsedData, QueryPlan, EngineResult } from '../types'
import { isValueSort, validateQueryPlan } from './queryPlan'

const MAX_ROWS = 10_000
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

  return { headers, rows, truncated: result.data.length > MAX_ROWS, totalRows: result.data.length }
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

export function executeQuery(data: ParsedData, queryPlan: QueryPlan): EngineResult {
  const validation = validateQueryPlan(queryPlan, data.headers)
  if (!validation.ok) throw new Error(validation.error)
  const plan = validation.plan

  let rows = [...data.rows]

  if (plan.filter) {
    const { field, op, value } = plan.filter
    const numValue = parseNumericCell(value)
    rows = rows.filter((row) => {
      const cellValue = row[field] ?? ''
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
        default:
          return true
      }
    })
  }

  const groups = new Map<string, number[]>()
  const countsByLabel = new Map<string, number>()
  let skippedCells = 0

  for (const row of rows) {
    const rawKey = row[plan.groupBy]
    const key = rawKey == null || rawKey.trim() === '' ? BLANK_LABEL : rawKey

    if (!groups.has(key)) groups.set(key, [])
    countsByLabel.set(key, (countsByLabel.get(key) ?? 0) + 1)

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
        agg = countsByLabel.get(label) ?? nums.length
        break
      case 'min':
        agg = nums.length > 0 ? Math.min(...nums) : 0
        break
      case 'max':
        agg = nums.length > 0 ? Math.max(...nums) : 0
        break
      default:
        agg = total
    }
    values.push(agg)
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
  }
}
