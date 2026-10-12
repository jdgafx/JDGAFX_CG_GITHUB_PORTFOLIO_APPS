import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkSegment, recompute } from '../../shared/recompute'
import type { Recomputed } from '../../shared/recompute'
import type { FigureKind, Rows, Segment } from '../../shared/types'
import { DATES, SCENARIO_KEYS, loadScenario, series } from '../fixtures/load'

type Claim = Extract<Segment, { t: 'claim' }>
const claim = (kind: FigureKind, pkg: string, value: string, over: Partial<Claim> = {}): Segment => ({
  t: 'claim',
  kind,
  package: pkg,
  span: 'none',
  day: '',
  value,
  ...over,
})
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b))
const reduced = (n: bigint, d: bigint): string => `${n / gcd(n, d)}/${d / gcd(n, d)}`

const rc = (date: '2026-10-11' | '2026-10-12', key: string): Recomputed => {
  const s = loadScenario(date, key)
  return recompute(s.rows, date, s.days)
}

describe('recompute equals expected.json', () => {
  for (const date of DATES)
    for (const key of SCENARIO_KEYS)
      it(`${date} ${key}`, () => {
        const s = loadScenario(date, key)
        const r = recompute(s.rows, date, s.days)
        expect(r.L).toBe(s.expected.L)
        expect(r.start).toBe(s.expected.start)
        expect([...r.noData].sort()).toEqual(s.expected.noData)
        for (const n of s.names) {
          const p = r.packages[n]!
          const e = s.expected.packages[n]!
          expect(p.windowTotal).toBe(BigInt(e.windowTotal))
          expect(p.last30Total).toBe(BigInt(e.last30Total))
          expect([p.peakDay, Number(p.peakValue)]).toEqual([e.peakDay, e.peakValue])
          expect([p.S1, p.n1, p.S0, p.n0, p.computable]).toEqual([BigInt(e.S1), e.n1, BigInt(e.S0), e.n0, e.computable])
          if (e.change) expect(reduced(p.changeNum, p.changeDen)).toBe(e.change)
          expect([...p.unusual.keys()].sort()).toEqual(e.unusual.map((u) => u.day))
          for (const u of e.unusual) expect(p.unusual.get(u.day)).toEqual({ kind: u.kind, median2: u.median * 2 })
          expect([...p.possibleGaps].sort()).toEqual(e.possibleGaps)
          expect(p.notAssessed).toEqual(e.notAssessed)
        }
      })
})

describe('independence', () => {
  it('imports nothing but the shared types', () => {
    const src = readFileSync(fileURLToPath(new URL('../../shared/recompute.ts', import.meta.url)), 'utf8')
    const specs = [...src.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(specs.length).toBeGreaterThan(0)
    for (const s of specs) expect(s).toBe('./types')
    expect(src).not.toMatch(/\bimport\(|\brequire\(/)
  })
})

describe('window totals and peaks', () => {
  const r2 = rc('2026-10-12', 'r2')
  const s2 = loadScenario('2026-10-12', 'r2')
  const vite = s2.expected.packages['vite']!
  it('the right total is checked, with the npm value shown', () => {
    expect(checkSegment(claim('window_total', 'vite', vite.windowTotal, { span: 'window' }), r2)).toMatchObject({ verdict: 'checked' })
    expect(checkSegment(claim('window_total', 'vite', vite.last30Total, { span: 'last30' }), r2).verdict).toBe('checked')
  })
  it('mutation: a total over a window shifted by one day (off-by-one L) is wrong', () => {
    const rows = s2.rows['vite'] as Rows
    const shifted = BigInt(vite.windowTotal) - BigInt(rows['2026-10-10']!) + BigInt(rows['2026-09-10']!)
    const c = checkSegment(claim('window_total', 'vite', String(shifted), { span: 'window' }), r2)
    expect(c).toMatchObject({ verdict: 'wrong', npm: vite.windowTotal })
  })
  it('an off-by-one count is wrong', () => {
    expect(checkSegment(claim('window_total', 'vite', String(BigInt(vite.windowTotal) + 1n), { span: 'window' }), r2).verdict).toBe('wrong')
  })
  it('a non-maximum peak is wrong; the maximum and its day are checked', () => {
    const rows = s2.rows['vite'] as Rows
    const second = Object.entries(rows)
      .filter(([d]) => d >= '2026-09-11' && d <= '2026-10-10' && d !== vite.peakDay)
      .map(([, v]) => v)
      .sort((a, b) => b - a)[0]!
    expect(checkSegment(claim('peak_value', 'vite', String(second), { span: 'window' }), r2).verdict).toBe('wrong')
    expect(checkSegment(claim('peak_value', 'vite', String(vite.peakValue), { span: 'window' }), r2).verdict).toBe('checked')
    expect(checkSegment(claim('peak_day', 'vite', vite.peakDay, { span: 'window' }), r2).verdict).toBe('checked')
    expect(checkSegment(claim('peak_day', 'vite', '2026-10-09', { span: 'window' }), r2)).toMatchObject({ verdict: 'wrong', npm: vite.peakDay })
  })
  it('on a tie the peak is the earliest day', () => {
    const rows = series('2026-08-01', 72, (i) => (i === 50 || i === 60 ? 900 : 100))
    const r = recompute({ a: rows }, '2026-10-12', 30)
    expect(checkSegment(claim('peak_day', 'a', '2026-09-20', { span: 'window' }), r).verdict).toBe('checked')
    expect(checkSegment(claim('peak_day', 'a', '2026-09-30', { span: 'window' }), r).verdict).toBe('wrong')
  })
  it('a value in the wrong form is wrong with a form reason', () => {
    for (const v of ['', '12.5', '1e9', '-5', '1,000'])
      expect(checkSegment(claim('window_total', 'vite', v, { span: 'window' }), r2)).toMatchObject({ verdict: 'wrong', reason: 'value form' })
    expect(checkSegment(claim('peak_day', 'vite', '', { span: 'window' }), r2)).toMatchObject({ verdict: 'wrong', reason: 'value form' })
    expect(checkSegment(claim('peak_day', 'vite', '2026-02-30', { span: 'window' }), r2)).toMatchObject({ verdict: 'wrong', reason: 'value form' })
  })
  it('an unknown package is wrong', () => {
    expect(checkSegment(claim('window_total', 'nope', '5', { span: 'window' }), r2).verdict).toBe('wrong')
  })
})

describe('L1: spans', () => {
  const r2 = rc('2026-10-12', 'r2')
  const vite = loadScenario('2026-10-12', 'r2').expected.packages['vite']!
  it('peak_value and peak_day with span last30 are wrong; window or none are checked', () => {
    for (const k of ['peak_value', 'peak_day'] as const) {
      const value = k === 'peak_value' ? String(vite.peakValue) : vite.peakDay
      expect(checkSegment(claim(k, 'vite', value, { span: 'last30' }), r2)).toMatchObject({ verdict: 'wrong', reason: 'span' })
      expect(checkSegment(claim(k, 'vite', value, { span: 'window' }), r2).verdict).toBe('checked')
      expect(checkSegment(claim(k, 'vite', value, { span: 'none' }), r2).verdict).toBe('checked')
    }
  })
  it('window_total with span none is wrong even when the number is right', () => {
    expect(checkSegment(claim('window_total', 'vite', vite.windowTotal, { span: 'none' }), r2)).toMatchObject({ verdict: 'wrong', reason: 'span' })
  })
  it('change_pct is checked when right with any span', () => {
    for (const span of ['window', 'last30', 'none'] as const)
      expect(checkSegment(claim('change_pct', 'vite', '+19.04', { span }), r2).verdict).toBe('checked')
  })
})

describe('day claims', () => {
  const r1 = rc('2026-10-12', 'r1')
  const s1 = loadScenario('2026-10-12', 'r1')
  it('day_value: the real value is checked, any other is wrong', () => {
    const v = String(s1.rows['react']!['2026-10-01'])
    expect(checkSegment(claim('day_value', 'react', v, { day: '2026-10-01' }), r1).verdict).toBe('checked')
    expect(checkSegment(claim('day_value', 'react', String(Number(v) + 1), { day: '2026-10-01' }), r1)).toMatchObject({ verdict: 'wrong', npm: v })
  })
  it('vite 21622609.5 on 06-03 is wrong (form, and 06-03 is a possible gap)', () => {
    expect(checkSegment(claim('day_value', 'vite', '21622609.5', { day: '2026-06-03' }), r1)).toMatchObject({ verdict: 'wrong', reason: 'value form' })
    expect(checkSegment(claim('day_value', 'vite', '21622609', { day: '2026-06-03' }), r1)).toMatchObject({ verdict: 'wrong', reason: 'possible gap' })
    expect(checkSegment(claim('day_value', 'vite', '0', { day: '2026-06-03' }), r1)).toMatchObject({ verdict: 'wrong', reason: 'possible gap' })
  })
  it('a baseline quoted as the day value is wrong', () => {
    const u = s1.expected.packages['react']!.unusual.find((x) => x.day === '2025-12-25')!
    expect(u.median).toBe(9639260)
    expect(checkSegment(claim('day_value', 'react', '9639260', { day: '2025-12-25' }), r1).verdict).toBe('wrong')
    expect(checkSegment(claim('day_value', 'react', String(u.value), { day: '2025-12-25' }), r1).verdict).toBe('checked')
  })
  it('a no-data day, a day outside the window and a bad day are wrong', () => {
    expect(checkSegment(claim('day_value', 'react', '0', { day: '2026-10-06' }), r1)).toMatchObject({ verdict: 'wrong', reason: 'no-data day' })
    expect(checkSegment(claim('day_value', 'react', '5', { day: '2025-10-10' }), r1)).toMatchObject({ verdict: 'wrong', reason: 'outside window' })
    expect(checkSegment(claim('day_value', 'react', '5', { day: '' }), r1).verdict).toBe('wrong')
  })
  it('unusual_day is judged against the full set, not the 6 sent', () => {
    const e = s1.expected.packages['react']!
    expect(e.unusual.length).toBeGreaterThan(6)
    const notTop = e.unusual.find((u) => !e.top6.includes(u.day))!
    expect(checkSegment(claim('unusual_day', 'react', notTop.day), r1).verdict).toBe('checked')
    expect(checkSegment(claim('unusual_day', 'react', '2026-10-01'), r1).verdict).toBe('wrong')
    expect(checkSegment(claim('unusual_day', 'react', '2026-06-03'), r1).verdict).toBe('wrong') // a gap is not unusual
  })
  it('a non-empty day must equal the value on date kinds', () => {
    const d = s1.expected.packages['react']!.unusual[0]!.day
    expect(checkSegment(claim('unusual_day', 'react', d, { day: d }), r1).verdict).toBe('checked')
    expect(checkSegment(claim('unusual_day', 'react', d, { day: '2026-10-01' }), r1)).toMatchObject({ verdict: 'wrong', reason: 'day differs from value' })
  })
  it('day is neutral inside the window and wrong outside it', () => {
    expect(checkSegment(claim('day', 'zod', '2026-09-15'), r1).verdict).toBe('neutral')
    expect(checkSegment(claim('day', 'zod', '2025-10-10'), r1).verdict).toBe('wrong')
    expect(checkSegment(claim('day', 'zod', '2026-10-11'), r1).verdict).toBe('wrong')
  })
})

describe('N1: change_pct is judged on the displayed one-decimal figure', () => {
  const r1 = rc('2026-10-12', 'r1')
  const r3 = rc('2026-10-12', 'r3')
  it('react +18.12 is checked (shows +18.1); +18.20 is wrong', () => {
    expect(checkSegment(claim('change_pct', 'react', '+18.12'), r1).verdict).toBe('checked')
    expect(checkSegment(claim('change_pct', 'react', '+18.20'), r1)).toMatchObject({ verdict: 'wrong', npm: '+18.1' })
  })
  it('drizzle-orm +34.07 is checked and +34.02 is wrong (shows +34.0)', () => {
    expect(checkSegment(claim('change_pct', 'drizzle-orm', '+34.07'), r3).verdict).toBe('checked')
    expect(checkSegment(claim('change_pct', 'drizzle-orm', '+34.02'), r3)).toMatchObject({ verdict: 'wrong', npm: '+34.1' })
    expect(checkSegment(claim('change_pct', 'drizzle-orm', '+34.05'), r3).verdict).toBe('checked') // shows +34.1
    expect(checkSegment(claim('change_pct', 'drizzle-orm', '+34.04'), r3).verdict).toBe('wrong')
  })
  it('the sign matters', () => {
    expect(checkSegment(claim('change_pct', 'react', '-18.12'), r1).verdict).toBe('wrong')
  })
  it('wrong forms are wrong', () => {
    for (const v of ['+18.1', '18.12', '+18.123', ''])
      expect(checkSegment(claim('change_pct', 'react', v), r1)).toMatchObject({ verdict: 'wrong', reason: 'value form' })
  })
  // one positive day per period: S1/1 vs S0/1 gives an exact change
  const tie = (s1: number, s0: number): Recomputed => {
    const rows = series('2026-08-01', 72, (_i, day) => (day === '2026-10-11' ? s1 : day === '2026-09-01' ? s0 : 0))
    return recompute({ a: rows }, '2026-10-12', 30)
  }
  it('an exact half tie accepts either neighbour (+10.05: 10.0 or 10.1)', () => {
    const r = tie(11005, 10000) // exactly +10.05
    for (const v of ['+10.05', '+10.04', '+10.06', '+9.95', '+10.14'])
      expect(checkSegment(claim('change_pct', 'a', v), r).verdict).toBe('checked')
    for (const v of ['+9.94', '+10.15', '+10.20'])
      expect(checkSegment(claim('change_pct', 'a', v), r).verdict).toBe('wrong')
  })
  it('an exact negative half tie (-1.05) accepts -1.0 and -1.1', () => {
    const r = tie(9895, 10000)
    for (const v of ['-1.05', '-1.04', '-1.00', '-1.14', '-0.95']) expect(checkSegment(claim('change_pct', 'a', v), r).verdict).toBe('checked')
    for (const v of ['-0.94', '-1.15', '+1.05']) expect(checkSegment(claim('change_pct', 'a', v), r).verdict).toBe('wrong')
  })
  it('-0.0 and +0.0 are the same figure', () => {
    const r = tie(10000, 10000)
    expect(checkSegment(claim('change_pct', 'a', '+0.00'), r).verdict).toBe('checked')
    expect(checkSegment(claim('change_pct', 'a', '-0.04'), r).verdict).toBe('checked')
    expect(checkSegment(claim('change_pct', 'a', '+0.04'), r).verdict).toBe('checked')
  })
  it('not computable is wrong with no basis', () => {
    const rows = series('2026-09-17', 25, () => 500)
    const r = recompute({ a: rows }, '2026-10-12', 30)
    expect(checkSegment(claim('change_pct', 'a', '+5.00'), r)).toMatchObject({ verdict: 'wrong', reason: 'no basis' })
  })
})

describe('recompute works on its own on synthetic rows', () => {
  it('days 30 and 365 give the same growth (M7), and zero days leave the basis', () => {
    const rows = series('2025-09-07', 400, (i, day) => (day === '2026-08-27' ? 0 : 1000 + (i % 7) * 10))
    const a = recompute({ a: rows }, '2026-10-12', 30).packages['a']!
    const b = recompute({ a: rows }, '2026-10-12', 365).packages['a']!
    expect([a.S0, a.n0, a.changeNum, a.changeDen]).toEqual([b.S0, b.n0, b.changeNum, b.changeDen])
    expect(a.n0).toBe(29)
  })
})
