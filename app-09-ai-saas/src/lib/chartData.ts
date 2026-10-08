import type { DailyUsage, FeatureUsage } from './mockData'

/** The field names the charts read. Each chart's dataKey is one of these, and the unit test checks the data has them. */
export const CHART_KEYS = {
  date: 'date',
  calls: 'calls',
  errorRate: 'errorRate',
  feature: 'feature',
} as const

/**
 * Recharts animates each series in with requestAnimationFrame. Until that advances, a line is drawn as a zero-length
 * dash and a bar at zero width, so a capture taken early shows axes only. The brief also rules out entrance
 * animation, so every series is drawn at once.
 */
export const CHART_MOTION = { isAnimationActive: false } as const

export interface DailyPoint {
  date: string
  calls: number
  errorRate: number
}

export interface FeaturePoint {
  feature: string
  calls: number
}

/** One point per day: a month-day label, that day's API calls and its error rate. */
export function toDailyPoints(rows: DailyUsage[]): DailyPoint[] {
  return rows.map((row) => ({ date: row.date.slice(5), calls: row.api_calls, errorRate: row.error_rate }))
}

/** One point per feature, in the order the usage rows arrive. */
export function toFeaturePoints(rows: FeatureUsage[]): FeaturePoint[] {
  return rows.map((row) => ({ feature: row.feature, calls: row.calls }))
}
