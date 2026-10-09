import { describe, expect, it } from 'vitest'
import { compact, full, longDate, seriesColor, shortDate, signedPercent } from '../../src/lib/format'

describe('format', () => {
  it('shortens large counts for axes and cards', () => {
    expect(compact(912_345_678)).toBe('912.3M')
    expect(compact(1_460_345_678)).toBe('1.5B')
    expect(compact(41_200)).toBe('41.2K')
    expect(compact(950)).toBe('950')
  })

  it('writes full counts with separators', () => {
    expect(full(32_583_774)).toBe('32,583,774')
  })

  it('writes dates in UTC whatever the local zone', () => {
    expect(shortDate('2026-09-08')).toBe('Sep 8')
    expect(longDate('2026-10-07')).toBe('Oct 7, 2026')
  })

  it('always shows the sign of a change', () => {
    expect(signedPercent(3.2)).toBe('+3.2%')
    expect(signedPercent(-4.1)).toBe('-4.1%')
    expect(signedPercent(0)).toBe('0%')
  })

  it('gives each package place its own colour variable, wrapping after five', () => {
    expect(seriesColor(0)).toBe('var(--hub-s1, #0e7c86)')
    expect(seriesColor(4)).toBe('var(--hub-s5, #667a0f)')
    expect(seriesColor(5)).toBe(seriesColor(0))
  })
})
