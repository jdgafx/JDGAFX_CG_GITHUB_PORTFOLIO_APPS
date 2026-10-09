import { halfWindow, type PackageFigures, type Summary } from '../../netlify/shared/contract'
import { daysBetween, isWeekend } from './dates'
import type { Day } from './npm'

/** One package's daily counts, as fetched. `key` names its row field and its colour; it is stable for the package's place in the selection. */
export interface Series {
  key: string
  name: string
  days: Day[]
}

/** A package's values across the window: one entry per date, null where npm reported nothing. */
export interface WindowSeries {
  key: string
  name: string
  values: (number | null)[]
}

export interface DownloadWindow {
  start: string
  end: string
  dates: string[]
  /** Dates inside the window where npm reported nothing for any selected package. They are left out of every figure. */
  gapDates: string[]
  /** Days between the last published day and the end of the range that was requested. */
  lagDays: number
  series: WindowSeries[]
}

/**
 * A day with no downloads for the whole selection counts as unreported only when the selection normally
 * moves more than this many downloads a day. Below it, a zero is a real quiet day.
 */
const GAP_MEDIAN_THRESHOLD = 100
/** Days in the moving average. */
export const AVERAGE_SPAN = 7

/** Rounds to a number of decimal places, halves up. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const present = (values: (number | null)[]): number[] => values.filter((v): v is number => v !== null)

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length
}

/**
 * Cuts the last `windowDays` days out of the fetched series. The window ends on the latest day on which
 * any package has downloads, not on today, because npm publishes a day or two late and reports the
 * unpublished days as zero. A day inside the window where every package is at zero is an npm gap, not
 * a quiet day, and is marked unreported.
 */
export function buildWindow(series: Series[], windowDays: number, requestedEnd: string): DownloadWindow | null {
  const counts = series.map((s) => new Map(s.days.map((d) => [d.day, d.downloads])))
  const allDates = [...new Set(series.flatMap((s) => s.days.map((d) => d.day)))].sort()
  const totalOn = (date: string) => counts.reduce((sum, c) => sum + (c.get(date) ?? 0), 0)

  const end = allDates.findLast((date) => totalOn(date) > 0)
  if (end === undefined) return null
  const dates = allDates.filter((date) => date <= end).slice(-windowDays)

  const busy = dates.map(totalOn).filter((total) => total > 0)
  const reliable = median(busy) >= GAP_MEDIAN_THRESHOLD
  const gapDates = reliable ? dates.filter((date) => totalOn(date) === 0) : []

  return {
    start: dates[0],
    end,
    dates,
    gapDates,
    lagDays: Math.max(0, daysBetween(end, requestedEnd)),
    series: series.map((s, i) => ({
      key: s.key,
      name: s.name,
      values: dates.map((date) => (gapDates.includes(date) ? null : (counts[i].get(date) ?? null))),
    })),
  }
}

/** Days in the window that npm reported. */
export function observedDays(span: DownloadWindow): number {
  return span.dates.length - span.gapDates.length
}

export function totalOf(values: (number | null)[]): number {
  return present(values).reduce((sum, v) => sum + v, 0)
}

/**
 * The latest half of the window against the half before it, as a percentage, using downloads per reported
 * day so an unreported day does not count as a low day. Null when either half has no reported day or the
 * earlier half has no downloads.
 */
export function halfWindowChange(values: (number | null)[]): number | null {
  const half = halfWindow(values.length)
  if (half === 0) return null
  const latest = mean(present(values.slice(values.length - half)))
  const earlier = mean(present(values.slice(values.length - 2 * half, values.length - half)))
  if (latest === null || earlier === null || earlier === 0) return null
  return roundTo((latest / earlier - 1) * 100, 1)
}

/** Weekend downloads per day as a percentage of weekday downloads per day. Null when either side has no reported day or weekdays are at zero. */
export function weekendPercent(dates: string[], values: (number | null)[]): number | null {
  const weekend: number[] = []
  const weekday: number[] = []
  dates.forEach((date, i) => {
    const value = values[i]
    if (value !== null) (isWeekend(date) ? weekend : weekday).push(value)
  })
  const weekendAvg = mean(weekend)
  const weekdayAvg = mean(weekday)
  if (weekendAvg === null || weekdayAvg === null || weekdayAvg === 0) return null
  return roundTo((weekendAvg / weekdayAvg) * 100, 1)
}

/**
 * Trailing average over `span` calendar days, ignoring unreported days inside the span. Null until a
 * full span of days has passed, and where the whole span is unreported.
 */
export function movingAverage(values: (number | null)[], span: number = AVERAGE_SPAN): (number | null)[] {
  return values.map((_, i) => (i < span - 1 ? null : mean(present(values.slice(i - span + 1, i + 1)))))
}

/** The figures for each package that the cards show and Generate insights sends. Null when the window holds no downloads. */
export function summarize(span: DownloadWindow): Summary | null {
  const observed = observedDays(span)
  if (observed === 0) return null
  const totals = span.series.map((s) => totalOf(s.values))
  const selectionTotal = totals.reduce((sum, t) => sum + t, 0)
  const packages = span.series.map((s, i): PackageFigures => ({
    name: s.name,
    total: totals[i],
    avgPerDay: Math.round(totals[i] / observed),
    changePct: halfWindowChange(s.values),
    weekendPct: weekendPercent(span.dates, s.values),
    sharePct: selectionTotal === 0 ? 0 : roundTo((totals[i] / selectionTotal) * 100, 1),
  }))
  return {
    startDate: span.start,
    endDate: span.end,
    windowDays: daysBetween(span.start, span.end) + 1,
    observedDays: observed,
    packages,
  }
}

export type ChartRow = Record<string, string | number | null>

/** One row per date with a field for each package's key, the shape Recharts reads. Unreported days stay null so the line breaks. */
export function dailyRows(span: DownloadWindow): ChartRow[] {
  return span.dates.map((date, i) => {
    const row: ChartRow = { date }
    for (const s of span.series) row[s.key] = s.values[i]
    return row
  })
}

/** The same rows with each package's moving average in place of its daily count. */
export function averageRows(span: DownloadWindow, days: number = AVERAGE_SPAN): ChartRow[] {
  const averages = span.series.map((s) => movingAverage(s.values, days))
  return span.dates.map((date, i) => {
    const row: ChartRow = { date }
    span.series.forEach((s, k) => {
      row[s.key] = averages[k][i]
    })
    return row
  })
}
