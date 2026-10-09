import type { NodeName, RunMetrics, TraceRow } from '../types/frames'

const CHEAP_NODES: ReadonlySet<NodeName> = new Set<NodeName>(['extract', 'check'])

/**
 * Totals over finished node rows. Cheap calls are the extract and check rows that ran and were costed,
 * failed ones included, so the count and the cost describe the same calls. The synthesis call is
 * synthesize. A cost is summed only where one exists, so a missing cost never counts as zero.
 */
export function metricsFor(rows: TraceRow[], totalMs: number): RunMetrics {
  const costed = rows.filter((r) => r.cost !== undefined)
  const sum = (list: TraceRow[]): number => list.reduce((n, r) => n + (r.cost ?? 0), 0)
  const cheap = costed.filter((r) => CHEAP_NODES.has(r.node))
  const synthesis = costed.filter((r) => r.node === 'synthesize')
  const anyEstimate = costed.some((r) => r.costSource === 'estimated')
  return {
    totalMs,
    totalTokens: rows.reduce((n, r) => n + (r.usage?.total_tokens ?? 0), 0),
    totalCost: costed.length > 0 ? sum(costed) : null,
    costSource: costed.length === 0 ? null : anyEstimate ? 'estimated' : 'usage',
    cheapCost: cheap.length > 0 ? sum(cheap) : null,
    cheapCalls: cheap.length,
    synthesisCost: synthesis.length > 0 ? sum(synthesis) : null,
  }
}
