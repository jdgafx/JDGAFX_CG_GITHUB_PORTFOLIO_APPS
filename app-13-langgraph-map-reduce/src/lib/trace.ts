import type { TraceRow } from '../types/frames'
import type { StartMark } from './view'

export interface Lane {
  left: number
  width: number
}

/**
 * Where each finished row sits on the shared time axis, as percentages. A row's start is the offset the server
 * sent when the step began; the nth row of a step (or of one chunk) pairs with the nth start of the same step,
 * so a retried chunk and the second pass keep their own bars. Parallel extract rows overlap, as they ran.
 */
export function laneFor(rows: readonly TraceRow[], starts: readonly StartMark[], runMs: number): Array<Lane | null> {
  const seen = new Map<string, number>()
  const key = (r: { node: string; chunk?: number }): string => `${r.node}:${r.chunk ?? ''}`
  const placed = rows.map((row) => {
    const k = key(row)
    const nth = seen.get(k) ?? 0
    seen.set(k, nth + 1)
    const start = starts.filter((s) => key(s) === k)[nth]
    return start ? { start: start.ms, ms: row.ms } : null
  })
  const axis = Math.max(runMs, 1, ...placed.map((p) => (p ? p.start + p.ms : 0)))
  return placed.map((p) =>
    p
      ? { left: Math.min((p.start / axis) * 100, 99.2), width: Math.min(Math.max((p.ms / axis) * 100, 0.8), 100 - (p.start / axis) * 100) }
      : null,
  )
}
