import { describe, expect, it } from 'vitest'
import { shouldScrollToResult } from '../../src/lib/scrollToResult'

describe('scrolling to an ended run', () => {
  it.each([
    [{ width: 390, ended: true, scrolledBy: 0 }, true],
    [{ width: 390, ended: true, scrolledBy: 40 }, true],
    [{ width: 390, ended: true, scrolledBy: 41 }, false],
    [{ width: 390, ended: true, scrolledBy: -400 }, false],
    [{ width: 999, ended: true, scrolledBy: 0 }, true],
    [{ width: 1000, ended: true, scrolledBy: 0 }, false],
    [{ width: 390, ended: false, scrolledBy: 0 }, false],
  ])('%j -> %s', (input, expected) => {
    expect(shouldScrollToResult(input)).toBe(expected)
  })
})
