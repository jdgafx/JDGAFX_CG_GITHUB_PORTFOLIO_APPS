import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, isWeekend, todayUtc, weekdayOf } from '../../src/lib/dates'

describe('dates', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-07', 5)).toBe('2026-10-12')
    expect(addDays('2026-10-07', -37)).toBe('2026-08-31')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('counts whole days between dates, negative when reversed', () => {
    expect(daysBetween('2026-09-08', '2026-10-07')).toBe(29)
    expect(daysBetween('2026-10-07', '2026-09-08')).toBe(-29)
    expect(daysBetween('2026-10-04', '2026-10-04')).toBe(0)
  })

  it('reads the weekday in UTC, Sunday as 0', () => {
    expect(weekdayOf('2026-09-21')).toBe(1)
    expect(weekdayOf('2026-09-27')).toBe(0)
    expect(weekdayOf('2026-09-26')).toBe(6)
    expect(isWeekend('2026-09-26')).toBe(true)
    expect(isWeekend('2026-09-25')).toBe(false)
  })

  it('takes today from the UTC date, not the local one', () => {
    expect(todayUtc(new Date('2026-10-09T23:30:00-05:00'))).toBe('2026-10-10')
    expect(todayUtc(new Date('2026-10-09T00:05:00Z'))).toBe('2026-10-09')
  })
})
