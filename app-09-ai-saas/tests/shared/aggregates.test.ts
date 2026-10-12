import { describe, expect, it } from 'vitest'
import { computeAggregates, computeFacts, growthBasis, growthPercent } from '../../shared/aggregates'
import { computeWindow } from '../../shared/window'
import type { ReleaseState } from '../../shared/types'
import { DATES, SCENARIO_KEYS, loadScenario, series } from '../fixtures/load'

const okState = (names: string[]): Record<string, ReleaseState> => Object.fromEntries(names.map((n) => [n, 'ok' as const]))

describe('aggregates equal expected.json', () => {
  for (const date of DATES)
    for (const key of SCENARIO_KEYS)
      it(`${date} ${key}: totals, peaks, S/n of both periods`, () => {
        const s = loadScenario(date, key)
        const w = computeWindow(s.rows, date, s.days)
        const facts = computeFacts(s.rows, w, s.releases, okState(s.names))
        expect(facts.map((f) => f.name)).toEqual(s.names)
        for (const f of facts) {
          const e = s.expected.packages[f.name]!
          expect(f.aggregates.windowTotal).toBe(BigInt(e.windowTotal))
          expect(f.aggregates.last30Total).toBe(BigInt(e.last30Total))
          expect(f.aggregates.peakDay).toBe(e.peakDay)
          expect(f.aggregates.peakValue).toBe(e.peakValue)
          expect(f.aggregates.growth).toEqual({
            S1: BigInt(e.S1),
            n1: e.n1,
            S0: BigInt(e.S0),
            n0: e.n0,
            computable: e.computable,
          })
        }
      })

  it('a total past 2^53 stays exact', () => {
    const rows = series('2026-08-01', 72, () => 9_007_199_254_740_000)
    const w = computeWindow({ a: rows }, '2026-10-12', 30)
    expect(computeAggregates(rows, w).windowTotal).toBe(30n * 9_007_199_254_740_000n)
  })
  it('the peak is the window maximum, the earliest day on a tie', () => {
    const rows = series('2026-08-01', 72, (i) => (i === 50 || i === 60 ? 900 : 100))
    const w = computeWindow({ a: rows }, '2026-10-12', 30)
    expect(computeAggregates(rows, w)).toMatchObject({ peakDay: '2026-09-20', peakValue: 900 })
  })
  it('the peak ignores days outside the window', () => {
    const rows = series('2026-08-01', 72, (i) => (i === 5 ? 5000 : 100))
    const w = computeWindow({ a: rows }, '2026-10-12', 30)
    expect(computeAggregates(rows, w).peakValue).toBe(100)
  })
})

describe('growth basis (option A: days with downloads above zero)', () => {
  it('excludes zero days from the sum and the count', () => {
    const rows = series('2026-07-01', 100, (i) => (i % 10 === 0 ? 0 : 1000)) // 07-01 .. 10-08
    const g = growthBasis(rows, ['2026-09-09', '2026-10-08'], ['2026-08-10', '2026-09-08'])
    expect(g.n1).toBe(27)
    expect(g.S1).toBe(27_000n)
    expect(g.n0).toBe(27)
    expect(g.computable).toBe(true)
  })
  it('M5: a package with no downloads in the earlier period is not computable', () => {
    const rows = series('2026-09-17', 25, () => 500) // 09-17 .. 10-11, 25 days old
    const w = computeWindow({ a: rows }, '2026-10-12', 30)
    expect(computeAggregates(rows, w).growth).toMatchObject({ n0: 0, S0: 0n, computable: false })
  })
  it('M5: no downloads in the past month is not computable either', () => {
    const rows = series('2026-07-01', 100, (i) => (i >= 70 ? 0 : 400))
    const g = growthBasis(rows, ['2026-09-09', '2026-10-08'], ['2026-08-10', '2026-09-08'])
    expect(g.n1).toBe(0)
    expect(g.computable).toBe(false)
  })
  it('M7: a partial zero at L-45 is excluded from S0 and n0, and change is the same at days 30 and 365', () => {
    // 400 days ending 2026-10-11 (L); zero at L-45 = 2026-08-27 lies in the month before (L-59..L-30)
    const rows = series('2025-09-07', 400, (i, day) => (day === '2026-08-27' ? 0 : 1000 + (i % 7) * 10))
    const w30 = computeWindow({ a: rows }, '2026-10-12', 30)
    const w365 = computeWindow({ a: rows }, '2026-10-12', 365)
    expect(w30.L).toBe('2026-10-11')
    const g30 = computeAggregates(rows, w30).growth
    const g365 = computeAggregates(rows, w365).growth
    expect(g30.n0).toBe(29)
    expect(g30).toEqual(g365)
  })
})

describe('computeFacts', () => {
  it('unusual days, possible gaps and not-assessed days come from the same window', () => {
    const s = loadScenario('2026-10-12', 'r1')
    const w = computeWindow(s.rows, '2026-10-12', 365)
    const f = computeFacts(s.rows, w, s.releases, okState(s.names))[0]!
    expect(f.name).toBe('react')
    expect(f.possibleGaps).toEqual(['2026-06-03'])
    expect(f.notAssessed).toHaveLength(23)
    expect(f.unusual).toHaveLength(14)
  })
  it('a failed release state makes every unusual row unavailable', () => {
    const s = loadScenario('2026-10-12', 'r1')
    const w = computeWindow(s.rows, '2026-10-12', 365)
    const facts = computeFacts(s.rows, w, s.releases, { ...okState(s.names), react: 'failed' })
    expect(facts[0]!.unusual.every((u) => u.release === 'unavailable' && u.version === undefined)).toBe(true)
    expect(facts[1]!.unusual.some((u) => u.release !== 'unavailable')).toBe(true)
  })
})

describe('growthPercent: the one one-decimal growth figure', () => {
  for (const date of DATES)
    for (const key of SCENARIO_KEYS)
      it(`${date} ${key}: equals expected.json change1, null when not computable`, () => {
        const s = loadScenario(date, key)
        const w = computeWindow(s.rows, date, s.days)
        for (const f of computeFacts(s.rows, w, s.releases, okState(s.names))) {
          const e = s.expected.packages[f.name]!
          expect(growthPercent(f.aggregates.growth)).toBe(e.computable ? e.change1 : null)
        }
      })
  const g = (S1: bigint, n1: number, S0: bigint, n0: number) => ({ S1, n1, S0, n0, computable: true })
  it('signs: a rise is +, a fall is -, flat is +0.0, a fall that rounds to zero has no minus', () => {
    expect(growthPercent(g(110n, 1, 100n, 1))).toBe('+10.0')
    expect(growthPercent(g(90n, 1, 100n, 1))).toBe('-10.0')
    expect(growthPercent(g(100n, 1, 100n, 1))).toBe('+0.0')
    expect(growthPercent(g(99_999n, 1, 100_000n, 1))).toBe('+0.0')
  })
  it('rounds half away from zero', () => {
    expect(growthPercent(g(11_005n, 1, 10_000n, 1))).toBe('+10.1')
    expect(growthPercent(g(9_895n, 1, 10_000n, 1))).toBe('-1.1')
  })
  it('is null when the growth is not computable', () => {
    expect(growthPercent({ S1: 5n, n1: 1, S0: 0n, n0: 0, computable: false })).toBeNull()
  })
})
