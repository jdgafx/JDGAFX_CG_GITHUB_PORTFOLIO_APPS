import Papa from 'papaparse'
import type { ParsedData, QueryPlan } from '../types'

export function parseCSV(csvString: string): ParsedData {
  const result = Papa.parse<Record<string, string>>(csvString, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
    transform: (v: string) => v.trim(),
  })

  const headers = result.meta.fields ?? []
  const rows = result.data

  return { headers, rows }
}

export function executeQuery(
  data: ParsedData,
  queryPlan: QueryPlan,
): { labels: string[]; datasets: { name: string; values: number[] }[] } {
  let rows = [...data.rows]

  if (queryPlan.filter) {
    const { field, op, value } = queryPlan.filter
    rows = rows.filter((row) => {
      const cellValue = row[field] ?? ''
      const numValue = parseFloat(value)
      const numCell = parseFloat(cellValue)
      switch (op) {
        case 'eq':
          return cellValue.toLowerCase() === value.toLowerCase()
        case 'neq':
          return cellValue.toLowerCase() !== value.toLowerCase()
        case 'gt':
          return !isNaN(numCell) && numCell > numValue
        case 'lt':
          return !isNaN(numCell) && numCell < numValue
        case 'gte':
          return !isNaN(numCell) && numCell >= numValue
        case 'lte':
          return !isNaN(numCell) && numCell <= numValue
        case 'contains':
          return cellValue.toLowerCase().includes(value.toLowerCase())
        default:
          return true
      }
    })
  }

  const groups = new Map<string, number[]>()

  for (const row of rows) {
    const key = row[queryPlan.groupBy] ?? 'Unknown'
    const fieldValue =
      queryPlan.aggregate.fn === 'count'
        ? 1
        : parseFloat(row[queryPlan.aggregate.field] ?? '0') || 0

    if (!groups.has(key)) {
      groups.set(key, [])
    }
    const arr = groups.get(key)
    if (arr) arr.push(fieldValue)
  }

  const labels: string[] = []
  const values: number[] = []

  for (const [label, nums] of groups) {
    labels.push(label)
    const total = nums.reduce((a, b) => a + b, 0)
    let agg: number
    switch (queryPlan.aggregate.fn) {
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
        agg = Math.min(...nums)
        break
      case 'max':
        agg = Math.max(...nums)
        break
      default:
        agg = total
    }
    values.push(agg)
  }

  if (queryPlan.sortBy) {
    const { field, dir } = queryPlan.sortBy
    const isValueSort =
      field === 'value' ||
      field === queryPlan.aggregate.field ||
      field === 'revenue' ||
      !data.headers.includes(field)

    const pairs = labels.map((label, i) => ({ label, value: values[i] ?? 0 }))

    pairs.sort((a, b) => {
      if (isValueSort) {
        return dir === 'asc' ? a.value - b.value : b.value - a.value
      }
      return dir === 'asc'
        ? a.label.localeCompare(b.label)
        : b.label.localeCompare(a.label)
    })

    labels.length = 0
    values.length = 0
    for (const p of pairs) {
      labels.push(p.label)
      values.push(p.value)
    }
  }

  return {
    labels,
    datasets: [{ name: queryPlan.aggregate.field, values }],
  }
}
