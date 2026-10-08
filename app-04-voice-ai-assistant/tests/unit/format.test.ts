import { describe, expect, it } from 'vitest'
import { formatCount, formatCountdown, formatMs, formatUsd } from '../../src/lib/format'

describe('formatMs', () => {
  it('rounds to whole milliseconds with a thousands separator', () => {
    expect(formatMs(1234.4)).toBe('1,234 ms')
    expect(formatMs(0)).toBe('0 ms')
  })

  it('says "not reported" when the server gave no timing', () => {
    expect(formatMs(undefined)).toBe('not reported')
  })
})

describe('formatCount', () => {
  it('adds thousands separators to token counts', () => {
    expect(formatCount(13)).toBe('13')
    expect(formatCount(1_234_567)).toBe('1,234,567')
  })

  it('says "not reported" when the provider gave no count', () => {
    expect(formatCount(undefined)).toBe('not reported')
  })
})

describe('formatUsd', () => {
  it('keeps six decimals, because one reply costs a fraction of a cent', () => {
    expect(formatUsd(0.0002)).toBe('$0.000200')
    expect(formatUsd(0.0000123)).toBe('$0.000012')
    expect(formatUsd(0)).toBe('$0.000000')
  })

  it('says "not reported" rather than inventing a cost', () => {
    expect(formatUsd(undefined)).toBe('not reported')
  })
})

describe('formatCountdown', () => {
  it('shows minutes and seconds, rounding partial seconds up', () => {
    expect(formatCountdown(90_000)).toBe('1:30')
    expect(formatCountdown(1_500)).toBe('0:02')
    expect(formatCountdown(59_001)).toBe('1:00')
  })

  it('never shows less than zero', () => {
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-250)).toBe('0:00')
  })
})
