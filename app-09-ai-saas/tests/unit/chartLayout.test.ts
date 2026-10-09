import { describe, expect, it } from 'vitest'
import type { DownloadWindow } from '../../src/lib/analytics'
import { chartLayout } from '../../src/lib/chartLayout'

const win = (days: number, ...levels: number[]): DownloadWindow => ({
  start: '2026-01-01',
  end: '2026-01-02',
  dates: Array.from({ length: days }, (_, i) => `d${i}`),
  gapDates: [],
  lagDays: 0,
  series: levels.map((level, i) => ({ key: `p${i}`, name: `p${i}`, values: Array.from({ length: days }, () => level) })),
})

describe('chartLayout', () => {
  it('draws daily lines at 30 days and the 7-day average from 90', () => {
    expect(chartLayout(win(30, 100, 120)).smooth).toBe(false)
    expect(chartLayout(win(90, 100, 120)).smooth).toBe(true)
    expect(chartLayout(win(365, 100, 120)).smooth).toBe(true)
  })

  it('splits into rows only when the biggest median is more than 8 times the smallest', () => {
    expect(chartLayout(win(30, 800, 100)).split).toBe(false) // exactly 8 times
    expect(chartLayout(win(30, 801, 100)).split).toBe(true)
    expect(chartLayout(win(30, 21_900_000, 2_300_000, 15_900_000)).split).toBe(true) // zod, sdk, react
  })

  it('never splits a single package, and ignores a package with no downloads', () => {
    expect(chartLayout(win(30, 5_000_000)).split).toBe(false)
    expect(chartLayout(win(30, 5_000_000, 0)).split).toBe(false)
  })
})
