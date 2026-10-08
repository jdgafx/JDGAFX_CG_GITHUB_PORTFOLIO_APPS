import { describe, expect, it } from 'vitest'
import { boundedInt } from '../../netlify/shared/config'

describe('boundedInt', () => {
  it('uses the fallback when the value is missing, blank or not a number', () => {
    expect(boundedInt(undefined, 1024, 16, 4096)).toBe(1024)
    expect(boundedInt('', 1024, 16, 4096)).toBe(1024)
    expect(boundedInt('   ', 1024, 16, 4096)).toBe(1024)
    expect(boundedInt('abc', 1024, 16, 4096)).toBe(1024)
    expect(boundedInt('Infinity', 1024, 16, 4096)).toBe(1024)
  })

  it('reads a whole number and ignores surrounding spaces', () => {
    expect(boundedInt('2048', 1024, 16, 4096)).toBe(2048)
    expect(boundedInt(' 2048 ', 1024, 16, 4096)).toBe(2048)
  })

  it('drops the fraction', () => {
    expect(boundedInt('12.9', 5, 1, 100)).toBe(12)
  })

  it('clamps a value below the minimum up to the minimum', () => {
    expect(boundedInt('0', 1024, 16, 4096)).toBe(16)
    expect(boundedInt('-5', 1024, 16, 4096)).toBe(16)
  })

  it('clamps a value above the maximum down to the maximum', () => {
    expect(boundedInt('99999', 1024, 16, 4096)).toBe(4096)
  })
})
