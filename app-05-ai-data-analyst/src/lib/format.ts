/** USD, with enough digits to show a small per-call cost. */
export function formatCost(value: number): string {
  return `$${value < 0.01 ? value.toFixed(6) : value.toFixed(4)}`
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

export function formatMs(value: number): string {
  return `${formatCount(Math.round(value))} ms`
}

/** The model id without its provider prefix: "anthropic/claude-haiku-5.5" -> "claude-haiku-5.5". */
export function shortModel(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1)
}

interface ShownResult {
  labels: string[]
  having?: { total: number }
  queryPlan: { chartType: string }
}

/** What a result drew, for a history line: "bar chart, 12 groups", or why nothing was drawn. */
export function drawnLine(result: ShownResult): string {
  if (result.labels.length > 0) {
    const groups = result.labels.length
    return `${result.queryPlan.chartType} chart, ${formatCount(groups)} ${groups === 1 ? 'group' : 'groups'}`
  }
  return result.having && result.having.total > 0 ? 'nothing drawn: no group met the threshold' : 'nothing drawn: no rows matched'
}
