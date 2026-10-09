import { SMOOTH_FROM_DAYS } from './analytics'
import type { DownloadWindow } from './analytics'

/** One package is split onto its own row when the biggest package's median day is more than this many times the smallest's. */
export const SPLIT_RATIO = 8

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * How the daily chart is laid out. From 90 days the 7-day average is the solid line over a faint daily line, because the
 * weekly cycle would otherwise fill the plot. With more than one package and a spread of scale above SPLIT_RATIO, each
 * package gets its own row with its own y axis, so a small package is not flattened at the floor by a large one.
 */
export function chartLayout(span: DownloadWindow): { smooth: boolean; split: boolean } {
  const medians = span.series.map((s) => median(s.values.filter((v): v is number => v !== null && v > 0)))
  const usable = medians.filter((m) => Number.isFinite(m) && m > 0)
  const split = usable.length > 1 && Math.max(...usable) / Math.min(...usable) > SPLIT_RATIO
  return { smooth: span.dates.length >= SMOOTH_FROM_DAYS, split }
}
