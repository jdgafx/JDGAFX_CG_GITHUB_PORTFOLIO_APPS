import { describe, expect, it } from 'vitest'
import { REQUEST_BUDGET_MS, remainingMs } from '../../netlify/shared/deadline'

describe('remainingMs', () => {
  it('leaves the 24 second request budget less the time already used', () => {
    expect(REQUEST_BUDGET_MS).toBe(24_000)
    const left = remainingMs(Date.now() - 10_000)
    expect(left).toBeGreaterThan(13_900)
    expect(left).toBeLessThanOrEqual(14_000)
  })

  it('never goes below zero once the budget is spent', () => {
    expect(remainingMs(Date.now() - 60_000)).toBe(0)
  })
})
