import { describe, expect, it } from 'vitest'
import {
  averageRows,
  buildWindow,
  dailyRows,
  halfWindowChange,
  logDomain,
  logRows,
  movingAverage,
  observedDays,
  summarize,
  totalOf,
  weekendPercent,
  type Series,
} from '../../src/lib/analytics'
import { addDays } from '../../src/lib/dates'

const START = '2026-09-21' // a Monday

/** Two weeks from Monday 2026-09-21 to Sunday 2026-10-04, then two unpublished days (npm reports them as zero). Wednesday 09-30 is an npm gap for both. */
const A_VALUES = [1000, 1100, 1200, 1100, 1000, 400, 400, 2000, 2200, 0, 2200, 2000, 800, 800, 0, 0]
const B_VALUES = [100, 100, 100, 100, 100, 50, 50, 200, 200, 0, 200, 200, 100, 100, 0, 0]

const toSeries = (key: string, name: string, values: number[]): Series => ({
  key,
  name,
  days: values.map((downloads, i) => ({ day: addDays(START, i), downloads })),
})

const SERIES = [toSeries('p0', 'alpha', A_VALUES), toSeries('p1', 'beta', B_VALUES)]
const REQUESTED_END = '2026-10-06'

describe('buildWindow', () => {
  const win = buildWindow(SERIES, 14, REQUESTED_END)

  it('ends on the latest day with downloads, not on the requested end', () => {
    expect(win?.end).toBe('2026-10-04')
    expect(win?.start).toBe('2026-09-21')
    expect(win?.dates).toHaveLength(14)
    expect(win?.lagDays).toBe(2)
  })

  it('marks a day where every package is at zero as unreported, and leaves it null', () => {
    expect(win?.gapDates).toEqual(['2026-09-30'])
    expect(win?.series[0].values[9]).toBeNull()
    expect(win?.series[1].values[9]).toBeNull()
    expect(win ? observedDays(win) : 0).toBe(13)
  })

  it('takes only the last N days when more are fetched', () => {
    const last7 = buildWindow(SERIES, 7, REQUESTED_END)
    expect(last7?.start).toBe('2026-09-28')
    expect(last7?.dates).toHaveLength(7)
    expect(last7?.series[0].values).toEqual([2000, 2200, null, 2200, 2000, 800, 800])
  })

  it('keeps a zero as a real quiet day when the selection is small', () => {
    const tiny = buildWindow([toSeries('p0', 'tiny', [3, 5, 0, 4, 2, 0, 6, 0])], 7, '2026-09-28')
    expect(tiny?.gapDates).toEqual([])
    expect(tiny?.end).toBe('2026-09-27')
    expect(tiny?.series[0].values).toEqual([3, 5, 0, 4, 2, 0, 6])
  })

  it('returns null when nothing in the range was downloaded', () => {
    expect(buildWindow([toSeries('p0', 'ghost', [0, 0, 0])], 30, '2026-09-23')).toBeNull()
  })
})

describe('window figures', () => {
  const win = buildWindow(SERIES, 14, REQUESTED_END)
  if (!win) throw new Error('fixture window missing')
  const [a, b] = win.series

  it('sums the reported days only', () => {
    expect(totalOf(a.values)).toBe(16_200)
    expect(totalOf(b.values)).toBe(1_600)
  })

  it('changes by the per-reported-day average of the latest half against the half before', () => {
    // Latest 7 days: 10000 over 6 reported days = 1666.67. Earlier 7: 6200 / 7 = 885.71.
    expect(halfWindowChange(a.values)).toBe(88.2)
    // 1000 / 6 = 166.67 against 600 / 7 = 85.71.
    expect(halfWindowChange(b.values)).toBe(94.4)
  })

  it('has no change when the earlier half has no downloads or a half is empty', () => {
    expect(halfWindowChange([0, 0, 0, 0, 5, 6, 7, 8])).toBeNull()
    expect(halfWindowChange([null, null, null, null, 5, 6, 7, 8])).toBeNull()
    expect(halfWindowChange([5])).toBeNull()
  })

  it('compares weekend and weekday downloads per day', () => {
    // Weekend 400, 400, 800, 800 = 600 a day. Weekdays 13800 over 9 days = 1533.33 a day.
    expect(weekendPercent(win.dates, a.values)).toBe(39.1)
    expect(weekendPercent(win.dates, b.values)).toBe(51.9)
  })

  it('has no weekend figure when a side has no reported day', () => {
    expect(weekendPercent(['2026-09-21', '2026-09-22'], [10, 20])).toBeNull()
    expect(weekendPercent(['2026-09-26', '2026-09-27'], [10, 20])).toBeNull()
    expect(weekendPercent(['2026-09-21', '2026-09-26'], [0, 20])).toBeNull()
  })
})

describe('movingAverage', () => {
  it('starts after a full span and averages the reported days inside it', () => {
    const win = buildWindow(SERIES, 14, REQUESTED_END)
    const averages = movingAverage(win?.series[0].values ?? [])
    expect(averages.slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(averages[6]).toBeCloseTo(6200 / 7, 6)
    // The window ending on the gap day: 1100, 1000, 400, 400, 2000, 2200 and the gap, over 6 reported days.
    expect(averages[9]).toBeCloseTo(7100 / 6, 6)
    expect(averages[13]).toBeCloseTo(10000 / 6, 6)
  })

  it('is null where the whole span is unreported', () => {
    expect(movingAverage([1, 2, 3, null, null, null], 3)).toEqual([null, null, 2, 2.5, 3, null])
  })
})

describe('summarize', () => {
  const win = buildWindow(SERIES, 14, REQUESTED_END)
  const summary = win ? summarize(win) : null

  it('works out each package from its reported days', () => {
    expect(summary).toEqual({
      startDate: '2026-09-21',
      endDate: '2026-10-04',
      windowDays: 14,
      observedDays: 13,
      packages: [
        { name: 'alpha', total: 16_200, avgPerDay: 1246, changePct: 88.2, weekendPct: 39.1, sharePct: 91 },
        { name: 'beta', total: 1_600, avgPerDay: 123, changePct: 94.4, weekendPct: 51.9, sharePct: 9 },
      ],
    })
  })

  it('shares add up to the whole selection', () => {
    const shares = summary?.packages.map((p) => p.sharePct) ?? []
    expect(shares.reduce((sum, s) => sum + s, 0)).toBe(100)
  })
})

describe('chart rows', () => {
  const win = buildWindow(SERIES, 14, REQUESTED_END)
  if (!win) throw new Error('fixture window missing')

  it('keys each package by its series key and keeps unreported days null', () => {
    const rows = dailyRows(win)
    expect(rows).toHaveLength(14)
    expect(rows[0]).toEqual({ date: '2026-09-21', p0: 1000, p1: 100 })
    expect(rows[9]).toEqual({ date: '2026-09-30', p0: null, p1: null })
  })

  it('puts the moving average in the same shape', () => {
    const rows = averageRows(win)
    expect(rows[0]).toEqual({ date: '2026-09-21', p0: null, p1: null })
    expect(rows[6].p0).toBeCloseTo(6200 / 7, 6)
    expect(rows[6].p1).toBeCloseTo(600 / 7, 6)
  })
})

describe('log axis rows', () => {
  // The 365-day case: npm reported zero for one package on a day when the other had downloads.
  const rows = [
    { date: '2026-06-02', p0: 31_000_000, p1: 240 },
    { date: '2026-06-03', p0: 0, p1: 251 },
    { date: '2026-06-04', p0: 30_500_000, p1: 0 },
    { date: '2026-06-05', p0: null, p1: 12 },
  ]

  it('turns zero and negative values into gaps and leaves everything else alone', () => {
    expect(logRows(rows)).toEqual([
      { date: '2026-06-02', p0: 31_000_000, p1: 240 },
      { date: '2026-06-03', p0: null, p1: 251 },
      { date: '2026-06-04', p0: 30_500_000, p1: null },
      { date: '2026-06-05', p0: null, p1: 12 },
    ])
  })

  it('sets the range from the smallest and largest positive values, to whole powers of ten', () => {
    expect(logDomain(logRows(rows))).toEqual([10, 100_000_000])
    expect(logDomain([{ date: 'x', p0: 5 }, { date: 'y', p0: 1000 }])).toEqual([1, 1000])
  })

  it('has no range when nothing is positive, so the chart stays linear', () => {
    expect(logDomain(logRows([{ date: '2026-06-03', p0: 0, p1: null }]))).toBeNull()
  })
})
