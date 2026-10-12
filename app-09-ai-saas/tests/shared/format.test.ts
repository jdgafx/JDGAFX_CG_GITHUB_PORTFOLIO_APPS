import { describe, expect, it } from 'vitest'
import { addDays, dayDiff, fixedDecimal, formatCount, formatDate, formatPct, isIsoDate } from '../../shared/format'

describe('format', () => {
  it('formats counts with commas, exactly, past 2^53', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(38105740)).toBe('38,105,740')
    expect(formatCount('5765986637')).toBe('5,765,986,637')
    expect(formatCount(9007199254740993n)).toBe('9,007,199,254,740,993')
    expect(formatCount('007')).toBe('7')
  })
  it('formats dates as D Mon YYYY without padding', () => {
    expect(formatDate('2026-10-01')).toBe('1 Oct 2026')
    expect(formatDate('2026-02-22')).toBe('22 Feb 2026')
    expect(formatDate('2025-12-07')).toBe('7 Dec 2025')
  })
  it('rounds the model two-decimal change to one decimal, half away from zero', () => {
    expect(formatPct('+34.07')).toBe('+34.1%')
    expect(formatPct('+34.02')).toBe('+34.0%')
    expect(formatPct('+18.12')).toBe('+18.1%')
    expect(formatPct('+10.05')).toBe('+10.1%')
    expect(formatPct('-1.05')).toBe('-1.1%')
    expect(formatPct('-0.04')).toBe('+0.0%')
    expect(formatPct('-0.00')).toBe('+0.0%')
    expect(formatPct('-0.05')).toBe('-0.1%')
    expect(formatPct('+0.00')).toBe('+0.0%')
    expect(formatPct('+99.95')).toBe('+100.0%')
  })
  it('returns null for a wrong form', () => {
    for (const v of ['', '34.07', '+34.1', '+34.071', '+3a.07', '+.07', ' +34.07']) expect(formatPct(v)).toBeNull()
  })
  it('fixed decimals are exact, half up', () => {
    expect(fixedDecimal(822294129n, 28n, 4)).toBe('29367647.4643')
    expect(fixedDecimal(1n, 16n, 4)).toBe('0.0625')
    expect(fixedDecimal(2n, 3n, 4)).toBe('0.6667')
    expect(fixedDecimal(7n, 7n, 4)).toBe('1.0000')
    expect(fixedDecimal(-5n, 2n, 0)).toBe('-3')
  })
  it('a negative that rounds to zero is 0, never -0', () => {
    expect(fixedDecimal(-1n, 1000n, 1)).toBe('0.0')
    expect(fixedDecimal(-1n, 3n, 0)).toBe('0')
    expect(fixedDecimal(-4n, 1000n, 1)).toBe('0.0')
    expect(fixedDecimal(-5n, 100n, 1)).toBe('-0.1')
  })
  it('does calendar arithmetic and validation', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(dayDiff('2026-10-12', '2026-10-10')).toBe(2)
    expect(isIsoDate('2026-02-28')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-2-3')).toBe(false)
    expect(isIsoDate('')).toBe(false)
  })
})
