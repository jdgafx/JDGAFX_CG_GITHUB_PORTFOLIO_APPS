import { describe, expect, it } from 'vitest'
import { computeWindow, WindowError } from '../../shared/window'
import { DATES, SCENARIO_KEYS, loadScenario, series } from '../fixtures/load'

describe('computeWindow on captured data', () => {
  for (const date of DATES)
    for (const key of SCENARIO_KEYS)
      it(`${date} ${key}: L, window, no-data set equal expected.json`, () => {
        const s = loadScenario(date, key)
        const w = computeWindow(s.rows, date, s.days)
        expect(w.runDate).toBe(date)
        expect(w.L).toBe(s.expected.L)
        expect(w.days).toBe(s.days)
        expect(w.start).toBe(s.expected.start)
        expect(w.past).toEqual(s.expected.past)
        expect(w.before).toEqual(s.expected.before)
        expect(w.name).toBe(s.expected.name)
        expect(w.noData).toEqual(s.expected.noData)
      })

  it('2026-10-12 r1: L is 10-10 because 10-11 is all zero', () => {
    const s = loadScenario('2026-10-12', 'r1')
    expect(s.rows['react']?.['2026-10-11']).toBe(0)
    const w = computeWindow(s.rows, '2026-10-12', 365)
    expect(w.noData).toContain('2026-10-11')
    expect(w.L).toBe('2026-10-10')
  })
  it('1 package: no no-data days; L is the latest day with a value above 0', () => {
    const s = loadScenario('2026-10-12', 'solo365')
    const w = computeWindow(s.rows, '2026-10-12', 365)
    expect(w.noData).toEqual([])
    expect(w.L).toBe('2026-10-10')
  })
})

describe('computeWindow rules on synthetic rows', () => {
  const base = (v: (i: number, day: string) => number) => series('2026-08-01', 72, v) // 08-01 .. 10-11
  it('a day where every selected package is 0 is no-data; one zero is not', () => {
    const a = base((i) => (i === 10 || i === 20 ? 0 : 1000))
    const b = base((i) => (i === 10 ? 0 : 2000))
    const w = computeWindow({ a, b }, '2026-10-12', 30)
    expect(w.noData).toEqual(['2026-08-11'])
  })
  it('L skips trailing no-data days; the run date itself is ignored', () => {
    const a = base((i) => (i >= 70 ? 0 : 1000)) // 10-10 and 10-11 zero
    const b = base((i) => (i >= 70 ? 0 : 1000))
    a['2026-10-12'] = 999
    b['2026-10-12'] = 999
    const w = computeWindow({ a, b }, '2026-10-12', 30)
    expect(w.L).toBe('2026-10-09')
    expect(w.noData).toEqual(['2026-10-10', '2026-10-11'])
  })
  it('1 package: L is the latest day above 0, zeros before it are not no-data', () => {
    const a = base((i) => (i === 40 || i >= 70 ? 0 : 1000))
    const w = computeWindow({ a }, '2026-10-12', 30)
    expect(w.L).toBe('2026-10-09')
    expect(w.noData).toEqual([])
  })
  it('window, past month and month before end at L', () => {
    const a = base(() => 5)
    const w = computeWindow({ a }, '2026-10-12', 90)
    expect(w.L).toBe('2026-10-11')
    expect(w.start).toBe('2026-07-14')
    expect(w.past).toEqual(['2026-09-12', '2026-10-11'])
    expect(w.before).toEqual(['2026-08-13', '2026-09-11'])
    expect(w.name).toBe('the past three months')
  })
  it('names 30, 90, 365 in words', () => {
    const a = base(() => 5)
    expect(computeWindow({ a }, '2026-10-12', 30).name).toBe('the past month')
    expect(computeWindow({ a }, '2026-10-12', 365).name).toBe('the past year')
  })
  it('all zero everywhere is an error', () => {
    const a = base(() => 0)
    const b = base(() => 0)
    expect(() => computeWindow({ a, b }, '2026-10-12', 30)).toThrow(WindowError)
    expect(() => computeWindow({ a }, '2026-10-12', 30)).toThrow('npm reports no downloads for these packages')
  })
  it('L earlier than run date minus 7 is an error; exactly minus 7 is allowed', () => {
    const stale = series('2026-08-01', 60, () => 10) // ends 09-29
    expect(() => computeWindow({ a: stale }, '2026-10-12', 30)).toThrow('npm has not published recent days yet')
    const edge = series('2026-08-01', 66, () => 10) // ends 10-05 = run-7
    expect(computeWindow({ a: edge }, '2026-10-12', 30).L).toBe('2026-10-05')
    const late = series('2026-08-01', 65, () => 10) // ends 10-04 = run-8
    expect(() => computeWindow({ a: late }, '2026-10-12', 30)).toThrow(WindowError)
  })
})
