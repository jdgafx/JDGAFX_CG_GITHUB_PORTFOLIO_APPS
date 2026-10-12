import type { RunTotals, TraceRow } from '../types'

/** Model calls of a row whose usage is not known: the ones it names, and a reply that came back with no usage block. */
function unreportedIn(row: TraceRow): number {
  const answeredBlind = row.model !== undefined && row.usage === undefined && row.cost === undefined ? 1 : 0
  return (row.unreportedCalls ?? 0) + answeredBlind
}

/**
 * Totals over the nodes that ran, failed ones included. Tokens and cost are the sums of what the provider reported,
 * and stay null when nothing was reported. A call with no usage is counted in `unreportedCalls`, so the page can
 * show the sum as "at least" instead of presenting it as complete. Shared by the server and the browser.
 */
export function totalsOf(rows: readonly TraceRow[]): RunTotals {
  const ran = rows.filter((row) => row.status !== 'skipped' && row.status !== 'pending')
  const nodeMs = ran.reduce((sum, row) => sum + row.ms, 0)
  const models = [...new Set(ran.flatMap((row) => (row.model ? [row.model] : [])))]
  const withTokens = ran.filter((row) => row.usage?.total_tokens !== undefined)
  const withCost = ran.filter((row) => row.cost !== undefined)
  const tokens = withTokens.length > 0 ? withTokens.reduce((sum, row) => sum + (row.usage?.total_tokens ?? 0), 0) : null
  const cost = withCost.length > 0 ? withCost.reduce((sum, row) => sum + (row.cost ?? 0), 0) : null
  const costSource = cost === null ? null : withCost.some((row) => row.costSource === 'estimated') ? 'estimated' : 'usage'
  const unreportedCalls = ran.reduce((sum, row) => sum + unreportedIn(row), 0)
  return { nodeMs, tokens, cost, costSource, models, unreportedCalls }
}
