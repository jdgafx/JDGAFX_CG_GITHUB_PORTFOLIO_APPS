import { describe, expect, it } from 'vitest'
import { computeUnusual, topUnusual } from '../../shared/unusual'
import { computeWindow } from '../../shared/window'
import type { Release, Rows, UnusualRow } from '../../shared/types'
import { DATES, SCENARIO_KEYS, loadScenario, series } from '../fixtures/load'

describe('unusual days equal expected.json', () => {
  for (const date of DATES)
    for (const key of SCENARIO_KEYS)
      it(`${date} ${key}: exact sets, medians, kinds, releases, gaps, not-assessed`, () => {
        const s = loadScenario(date, key)
        const w = computeWindow(s.rows, date, s.days)
        for (const n of s.names) {
          const r = computeUnusual(n, s.rows, w, s.releases[n]!, 'ok')
          const e = s.expected.packages[n]!
          expect(r.unusual).toEqual(e.unusual)
          expect(r.possibleGaps).toEqual(e.possibleGaps)
          expect(r.notAssessed).toEqual(e.notAssessed)
        }
      })

  it('30-day sets are the exact ones of the live runs (drizzle-orm 6, webpack 1, typeorm 1, prisma 0)', () => {
    const s = loadScenario('2026-10-12', 'r3')
    const w = computeWindow(s.rows, '2026-10-12', 30)
    const count = (n: string) => computeUnusual(n, s.rows, w, s.releases[n]!, 'ok').unusual.length
    expect([count('prisma'), count('drizzle-orm'), count('typeorm')]).toEqual([0, 6, 1])
  })
  it('not assessed: 22 per r1 package on 10-11 and 23 on 10-12', () => {
    for (const [date, n] of [['2026-10-11', 22], ['2026-10-12', 23]] as const) {
      const s = loadScenario(date, 'r1')
      const w = computeWindow(s.rows, date, 365)
      for (const name of s.names) expect(computeUnusual(name, s.rows, w, [], 'ok').notAssessed).toHaveLength(n)
    }
  })
})

describe('possible npm gaps on captured data', () => {
  it('06-03 for react, vite and sdk, 06-05 for zod: gaps, not unusual', () => {
    const s = loadScenario('2026-10-12', 'r1')
    const w = computeWindow(s.rows, '2026-10-12', 365)
    const gapOf = (n: string) => computeUnusual(n, s.rows, w, s.releases[n]!, 'ok')
    for (const n of ['react', 'vite', '@anthropic-ai/sdk']) {
      expect(gapOf(n).possibleGaps).toEqual(['2026-06-03'])
      expect(gapOf(n).unusual.map((u) => u.day)).not.toContain('2026-06-03')
    }
    expect(gapOf('zod').possibleGaps).toEqual(['2026-06-05'])
    expect(gapOf('zod').unusual.map((u) => u.day)).not.toContain('2026-06-05')
  })
  it('mutation: with a small non-zero value on 06-03 the day becomes a drop and stops being a gap', () => {
    const s = loadScenario('2026-10-12', 'r1')
    const rows = { ...s.rows, react: { ...s.rows['react']!, '2026-06-03': 5 } }
    const w = computeWindow(rows, '2026-10-12', 365)
    const r = computeUnusual('react', rows, w, [], 'ok')
    expect(r.possibleGaps).not.toContain('2026-06-03')
    expect(r.unusual.find((u) => u.day === '2026-06-03')).toMatchObject({ kind: 'drop', value: 5 })
  })
  it('1 package: every assessed zero day is a possible gap (07-12 and 06-03 for react)', () => {
    const s = loadScenario('2026-10-12', 'solo365')
    const w = computeWindow(s.rows, '2026-10-12', 365)
    const r = computeUnusual('react', s.rows, w, [], 'ok')
    expect(r.possibleGaps).toEqual(s.expected.packages['react']!.possibleGaps)
    expect(r.possibleGaps).toContain('2026-07-12')
  })
})

describe('unusual rules on synthetic rows', () => {
  // 120 days ending 2026-10-11 (a Sunday-free arithmetic: same-weekday days are 7 apart).
  const START = '2026-06-14'
  const TARGET_I = 110 // 2026-10-02
  const TARGET = '2026-10-02'
  const mk = (baseValues: number[], v: number, extra?: (i: number) => number | undefined): Rows =>
    series(START, 120, (i) => {
      const k = (TARGET_I - i) / 7
      if (i === TARGET_I) return v
      if (Number.isInteger(k) && k >= 1 && k <= 8) return baseValues[k - 1]!
      return extra?.(i) ?? 1000
    })
  const run = (rows: Rows, other?: Rows) => {
    const set: Record<string, Rows> = other ? { a: rows, b: other } : { a: rows }
    const w = computeWindow(set, '2026-10-12', 30)
    return computeUnusual('a', set, w, [], 'ok')
  }
  it('even count: the median of 1000,1000,1000,1000,2000,2000,2000,2000 is 1500 and the boundary is inclusive', () => {
    const base = [1000, 1000, 1000, 1000, 2000, 2000, 2000, 2000]
    const at = (v: number) => run(mk(base, v)).unusual.find((u) => u.day === TARGET)
    expect(at(2250)).toMatchObject({ kind: 'spike', median: 1500 })
    expect(at(2249)).toBeUndefined()
    expect(at(750)).toMatchObject({ kind: 'drop', median: 1500 })
    expect(at(751)).toBeUndefined()
  })
  it('even count with a half: median 1002.5 gives spike at 1504 but not 1503', () => {
    const base = [1001, 1002, 1003, 1004, 1001, 1002, 1003, 1004]
    const at = (v: number) => run(mk(base, v)).unusual.find((u) => u.day === TARGET)
    expect(at(1504)).toMatchObject({ kind: 'spike', median: 1002.5 })
    expect(at(1503)).toBeUndefined()
  })
  it('odd count uses the middle value; fewer than 4 values is not assessed', () => {
    const odd = [1000, 1100, 1200, 1300, 1400, 0, 0, 0] // 5 non-zero values: median 1200
    expect(run(mk(odd, 1800)).unusual[0]).toMatchObject({ kind: 'spike', median: 1200 })
    const three = [1000, 1100, 1200, 0, 0, 0, 0, 0]
    const r = run(mk(three, 1800))
    expect(r.notAssessed).toContain(TARGET)
    expect(r.unusual.find((u) => u.day === TARGET)).toBeUndefined()
  })
  it('a base below 100 is not assessed', () => {
    const r = run(mk([99, 99, 99, 99, 99, 99, 99, 99], 500))
    expect(r.notAssessed).toContain(TARGET)
    const r2 = run(mk([100, 100, 100, 100, 100, 100, 100, 100], 500))
    expect(r2.unusual.find((u) => u.day === TARGET)?.kind).toBe('spike')
  })
  it('a zero day is a possible gap when another package has v > 0, and is not unusual', () => {
    const a = mk([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], 0)
    const b = series(START, 120, () => 500)
    const r = run(a, b)
    expect(r.possibleGaps).toContain(TARGET)
    expect(r.unusual.find((u) => u.day === TARGET)).toBeUndefined()
  })
  it('a day where every package is 0 is no-data: neither gap, nor unusual, nor not-assessed', () => {
    const a = mk([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], 0)
    const b = mk([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], 0)
    const r = run(a, b)
    expect(r.possibleGaps).not.toContain(TARGET)
    expect(r.notAssessed).not.toContain(TARGET)
    expect(r.unusual.find((u) => u.day === TARGET)).toBeUndefined()
  })
  it('a zero day with a base below 4 values is not assessed, so not a gap', () => {
    const a = mk([1000, 0, 0, 0, 0, 0, 0, 0], 0)
    const b = series(START, 120, () => 500)
    const r = run(a, b)
    expect(r.possibleGaps).not.toContain(TARGET)
    expect(r.notAssessed).toContain(TARGET)
  })
  it('1 package: a zero day with a full base is a possible gap', () => {
    const r = run(mk([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], 0))
    expect(r.possibleGaps).toContain(TARGET)
  })
  it('no-data days are skipped when taking the baseline', () => {
    // b is also 0 where a is 0 at d-14, so d-14 is no-data; a's baseline has 7 values from the others
    const base = [1000, 0, 1000, 1000, 1000, 1000, 1000, 1000]
    const a = mk(base, 1600)
    const b = mk(base, 1600)
    const r = run(a, b)
    expect(r.unusual.find((u) => u.day === TARGET)).toMatchObject({ kind: 'spike', median: 1000 })
  })
})

describe('release near an unusual day', () => {
  // spike on TARGET (2026-10-02) with base 1000
  const rows = series('2026-06-14', 120, (i) => (i === 110 ? 2000 : 1000))
  const w = computeWindow({ a: rows }, '2026-10-12', 30)
  const rel = (...l: Array<[string, string]>): Release[] => l.map(([day, version]) => ({ day, version }))
  const row = (r: Release[], state: 'ok' | 'failed' = 'ok') =>
    computeUnusual('a', { a: rows }, w, r, state).unusual.find((u) => u.day === '2026-10-02') as UnusualRow
  it('same day is 0, one day before is 1, two is 2, three is none, a later release is ignored', () => {
    expect(row(rel(['2026-10-02', '1.0.0']))).toMatchObject({ release: 0, version: '1.0.0' })
    expect(row(rel(['2026-10-01', '1.0.1']))).toMatchObject({ release: 1, version: '1.0.1' })
    expect(row(rel(['2026-09-30', '1.0.2']))).toMatchObject({ release: 2, version: '1.0.2' })
    expect(row(rel(['2026-09-29', '1.0.3'])).release).toBe('none')
    expect(row(rel(['2026-10-03', '1.0.4'])).release).toBe('none')
  })
  it('the nearest release wins; several on that day show the highest version', () => {
    const r = rel(['2026-09-30', '9.9.9'], ['2026-10-01', '19.0.3'], ['2026-10-01', '19.2.1'], ['2026-10-01', '19.1.10'])
    expect(row(r)).toMatchObject({ release: 1, version: '19.2.1' })
  })
  it('a failed release state gives unavailable and no version', () => {
    const r = row(rel(['2026-10-02', '1.0.0']), 'failed')
    expect(r.release).toBe('unavailable')
    expect(r.version).toBeUndefined()
  })
})

describe('topUnusual', () => {
  const u = (day: string, value: number, median: number, kind: 'spike' | 'drop'): UnusualRow => ({ day, value, median, kind, release: 'none' })
  it('keeps the 6 strongest by ratio (drop: median over value), in day order', () => {
    const rows = [
      u('2026-01-01', 2000, 1000, 'spike'), // 2
      u('2026-01-02', 100, 1000, 'drop'), // 10
      u('2026-01-03', 1600, 1000, 'spike'), // 1.6
      u('2026-01-04', 3000, 1000, 'spike'), // 3
      u('2026-01-05', 400, 1000, 'drop'), // 2.5
      u('2026-01-06', 5000, 1000, 'spike'), // 5
      u('2026-01-07', 1500, 1000, 'spike'), // 1.5
      u('2026-01-08', 0.5, 1000, 'drop'), // value floor 1 -> 1000
    ]
    expect(topUnusual(rows).map((r) => r.day)).toEqual(['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-08'])
    expect(topUnusual(rows, 2).map((r) => r.day)).toEqual(['2026-01-02', '2026-01-08'])
  })
  it('matches expected top6 on captured data', () => {
    const s = loadScenario('2026-10-12', 'r1')
    const w = computeWindow(s.rows, '2026-10-12', 365)
    for (const n of s.names) {
      const r = computeUnusual(n, s.rows, w, s.releases[n]!, 'ok')
      expect(topUnusual(r.unusual).map((x) => x.day)).toEqual(s.expected.packages[n]!.top6)
    }
  })
})
