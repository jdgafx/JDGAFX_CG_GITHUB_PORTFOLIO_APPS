import { describe, expect, it } from 'vitest'
import type { Aggregates } from '../shared/types'

describe('tooling smoke', () => {
  it('compiles the frozen shared contract and supports bigint totals', () => {
    const a: Aggregates = {
      windowTotal: 10n,
      last30Total: 4n,
      peakDay: '2026-10-11',
      peakValue: 3,
      growth: { S1: 1n, n1: 1, S0: 1n, n0: 1, computable: true },
    }
    expect(a.windowTotal + a.last30Total).toBe(14n)
  })
})
