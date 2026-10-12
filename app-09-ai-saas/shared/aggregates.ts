import { addDays } from './format'
import { computeUnusual } from './unusual'
import type { Aggregates, Day, Growth, PackageFacts, Release, ReleaseState, Rows, RunWindow } from './types'

function sumRange(rows: Rows, from: Day, to: Day): bigint {
  let total = 0n
  for (let d = from; d <= to; d = addDays(d, 1)) total += BigInt(rows[d] ?? 0)
  return total
}

/**
 * The growth basis, and the single swap point for option B (the plain 30-day sums): option A, built
 * here, sums and counts only the days with downloads above zero in each 30-day period, so the
 * result does not depend on the possible-gap rule or on how long the window is. For B, count every
 * day and keep the sums. shared/recompute.ts mirrors this on its own.
 */
export function growthBasis(rows: Rows, past: [Day, Day], before: [Day, Day]): Growth {
  const basis = (from: Day, to: Day): { S: bigint; n: number } => {
    let S = 0n
    let n = 0
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const v = rows[d] ?? 0
      if (v > 0) {
        S += BigInt(v)
        n++
      }
    }
    return { S, n }
  }
  const p = basis(past[0], past[1])
  const b = basis(before[0], before[1])
  return { S1: p.S, n1: p.n, S0: b.S, n0: b.n, computable: p.n > 0 && b.n > 0 && b.S > 0n }
}

export function computeAggregates(rows: Rows, window: RunWindow): Aggregates {
  let peakDay = window.start
  let peakValue = -1
  for (let d = window.start; d <= window.L; d = addDays(d, 1)) {
    const v = rows[d] ?? 0
    if (v > peakValue) {
      peakValue = v
      peakDay = d
    }
  }
  return {
    windowTotal: sumRange(rows, window.start, window.L),
    last30Total: sumRange(rows, window.past[0], window.past[1]),
    peakDay,
    peakValue,
    growth: growthBasis(rows, window.past, window.before),
  }
}

/** Everything code knows about each selected package, in the order of `rowsByName`. */
export function computeFacts(
  rowsByName: Record<string, Rows>,
  window: RunWindow,
  releases: Record<string, Release[]>,
  releaseState: Record<string, ReleaseState>,
): PackageFacts[] {
  return Object.keys(rowsByName).map((name) => {
    const rows = rowsByName[name] as Rows
    const u = computeUnusual(name, rowsByName, window, releases[name] ?? [], releaseState[name] ?? 'failed')
    return {
      name,
      aggregates: computeAggregates(rows, window),
      unusual: u.unusual,
      possibleGaps: u.possibleGaps,
      notAssessed: u.notAssessed,
    }
  })
}
