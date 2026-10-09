import type { RunTotals, TraceRow } from '../types'

/**
 * Totals over the nodes that ran. Tokens and cost are sums only when every model call reported
 * them, so a partial figure never appears as a whole one. Shared by the server and the browser.
 */
export function totalsOf(rows: readonly TraceRow[]): RunTotals {
  const ran = rows.filter((row) => row.status !== 'skipped' && row.status !== 'pending')
  const modelRows = ran.filter((row) => row.model !== undefined)
  const nodeMs = ran.reduce((sum, row) => sum + row.ms, 0)
  const models = [...new Set(modelRows.map((row) => row.model ?? ''))].filter(Boolean)
  const tokens =
    modelRows.length > 0 && modelRows.every((row) => row.usage?.total_tokens !== undefined)
      ? modelRows.reduce((sum, row) => sum + (row.usage?.total_tokens ?? 0), 0)
      : null
  const cost =
    modelRows.length > 0 && modelRows.every((row) => row.cost !== undefined)
      ? modelRows.reduce((sum, row) => sum + (row.cost ?? 0), 0)
      : null
  const costSource = cost === null ? null : modelRows.some((row) => row.costSource === 'estimated') ? 'estimated' : 'usage'
  return { nodeMs, tokens, cost, costSource, models }
}
