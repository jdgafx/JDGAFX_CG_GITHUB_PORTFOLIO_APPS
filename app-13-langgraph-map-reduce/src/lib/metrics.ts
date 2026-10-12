import type { ModelCheck, NodeName, RunMetrics, TraceRow } from '../types/frames'

const CHEAP_NODES: ReadonlySet<NodeName> = new Set<NodeName>(['extract', 'check'])

/** Worse checks rank higher. A run's readout shows the worst check among its calls. */
const CHECK_RANK: Record<ModelCheck, number> = { match: 0, unchecked: 1, 'not-reported': 2, mismatch: 3 }

/**
 * The worst model check over the calls that got a reply, or null when none did. A call with no reply has no check
 * and is left out, so a timed-out chunk does not change the readout.
 */
export function worstModelCheck(rows: TraceRow[]): ModelCheck | null {
  let worst: ModelCheck | null = null
  for (const row of rows) {
    if (row.modelCheck === undefined) continue
    if (worst === null || CHECK_RANK[row.modelCheck] > CHECK_RANK[worst]) worst = row.modelCheck
  }
  return worst
}

/** A call that was made but never answered: its row names the model it asked, and no reply gave a usage block. A call that was never made has no model on its row. */
export const isUnreported = (row: TraceRow): boolean => row.model !== undefined && row.priceState === undefined

/** The sum of the costs of these calls, or null when there are none or any of them has no price. A missing price never counts as zero. */
function costOf(calls: TraceRow[]): number | null {
  if (calls.length === 0 || calls.some((r) => r.cost === undefined)) return null
  return calls.reduce((n, r) => n + (r.cost ?? 0), 0)
}

/**
 * Totals over finished node rows. An answered call is one whose reply arrived, so it carries a price state;
 * a call that timed out or was refused has none. Cheap calls are the answered extract and check rows,
 * failed ones included, so the count and the cost describe the same calls. The synthesis call is synthesize.
 * A total exists only when every call it covers was priced, and the note says why one is missing.
 */
export function metricsFor(rows: TraceRow[], totalMs: number): RunMetrics {
  const unreported = rows.filter(isUnreported)
  const answered = rows.filter((r) => r.priceState !== undefined)
  const unpriced = answered.filter((r) => r.priceState !== 'priced')
  const cheap = answered.filter((r) => CHEAP_NODES.has(r.node))
  const total = costOf(answered)
  return {
    totalMs,
    totalTokens: rows.reduce((n, r) => n + (r.usage?.total_tokens ?? 0), 0),
    totalCost: total,
    priceNote: unpriced.length === 0 ? null : unpriced.some((r) => r.priceState === 'unavailable') ? 'unavailable' : 'no-served-model',
    cheapCost: costOf(cheap),
    cheapCalls: cheap.length,
    synthesisCost: costOf(answered.filter((r) => r.node === 'synthesize')),
    unreportedCalls: unreported.length,
  }
}
