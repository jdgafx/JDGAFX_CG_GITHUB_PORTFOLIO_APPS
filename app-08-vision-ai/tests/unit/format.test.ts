import { describe, expect, it } from 'vitest'
import { formatCount, formatMs, formatSeconds, formatUsd } from '../../src/lib/format'

describe('format helpers', () => {
  it('formats milliseconds with a thousands separator', () => {
    expect(formatMs(1234.4)).toBe('1,234 ms')
    expect(formatMs(0)).toBe('0 ms')
  })

  it('formats seconds to one decimal place', () => {
    expect(formatSeconds(4200)).toBe('4.2 s')
    expect(formatSeconds(999)).toBe('1.0 s')
  })

  it('shows a missing count as not reported, never as zero', () => {
    expect(formatCount(undefined)).toBe('not reported')
    expect(formatCount(1200)).toBe('1,200')
    expect(formatCount(0)).toBe('0')
  })

  it('shows a cost to six decimal places, or not reported when the provider sent none', () => {
    expect(formatUsd(0.0002)).toBe('$0.000200')
    expect(formatUsd(0)).toBe('$0.000000')
    expect(formatUsd(undefined)).toBe('not reported')
  })
})
