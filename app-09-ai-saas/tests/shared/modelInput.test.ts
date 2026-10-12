import { describe, expect, it } from 'vitest'
import { computeFacts } from '../../shared/aggregates'
import { CLAIM_SCHEMA, SYSTEM_RULES, buildPastRows, buildUserMessage, decodeRequest, encodeRequest } from '../../shared/modelInput'
import { topUnusual } from '../../shared/unusual'
import { computeWindow } from '../../shared/window'
import type { ExplainRequest, ReleaseState, Rows } from '../../shared/types'
import { fname, loadGolden, loadGoldenJson, loadScenario, series } from '../fixtures/load'
import type { Scenario } from '../fixtures/load'

function requestFor(s: Scenario, target: string, state: ReleaseState = 'ok'): ExplainRequest {
  const releaseState = Object.fromEntries(s.names.map((n) => [n, state]))
  const window = computeWindow(s.rows, s.date, s.days)
  const facts = computeFacts(s.rows, window, s.releases, releaseState)
  return {
    target,
    names: s.names,
    window,
    facts: facts.map((f) => ({ ...f, unusual: topUnusual(f.unusual) })),
    pastRows: Object.fromEntries(facts.map((f) => [f.name, buildPastRows(s.rows[f.name] as Rows, window, f)])),
    releaseState,
  }
}

describe('buildUserMessage equals the messages sent in the live runs', () => {
  const cases: Array<[string, string, ReleaseState]> = [
    ['r1', 'r1', 'ok'],
    ['r2', 'r2', 'ok'],
    ['r3', 'r3', 'ok'],
    ['r1u', 'r1', 'failed'],
  ]
  for (const [golden, key, state] of cases) {
    const s = loadScenario('2026-10-12', key)
    for (const target of s.names)
      it(`${golden} ${target}: byte-identical`, () => {
        expect(buildUserMessage(requestFor(s, target, state))).toBe(loadGolden(`user-${golden}-${fname(target)}.txt`))
      })
  }
})

describe('content rules', () => {
  const s = loadScenario('2026-10-12', 'r1')
  const msg = buildUserMessage(requestFor(s, 'react'))
  it('has no version, release id, unusual count or scientific notation', () => {
    const versions = Object.values(s.releases).flat().map((r) => r.version)
    const nearVersions = requestFor(s, 'react').facts.flatMap((f) => f.unusual.map((u) => u.version)).filter(Boolean) as string[]
    expect(nearVersions.length).toBeGreaterThan(0)
    for (const v of new Set([...versions, ...nearVersions])) expect(msg).not.toContain(` ${v}`)
    expect(msg).not.toMatch(/R\d/)
    expect(msg).not.toMatch(/\d[eE][+-]?\d/)
    expect(msg).not.toMatch(/\bunusual (days?|count)\b.*\d+ /i)
    expect(msg).not.toMatch(/\bv?\d+\.\d+\.\d+\b/) // no x.y.z anywhere
  })
  it('names the window in words', () => {
    expect(msg).toContain('(the past year)')
    expect(buildUserMessage(requestFor(loadScenario('2026-10-12', 'r1d90'), 'react'))).toContain('(the past three months)')
    expect(buildUserMessage(requestFor(loadScenario('2026-10-12', 'r2'), 'vite'))).toContain('(the past month)')
  })
  it('lists only the no-data days inside the window', () => {
    const line = (m: string) => m.split('\n')[1]!
    expect(line(msg)).toBe('no-data days in the window (every package 0, npm gap): ' + s.expected.noDataInWindow.join(', '))
    const m30 = buildUserMessage(requestFor(loadScenario('2026-10-12', 'r1d30'), 'react'))
    const e30 = loadScenario('2026-10-12', 'r1d30').expected
    expect(line(m30)).toBe('no-data days in the window (every package 0, npm gap): ' + e30.noDataInWindow.join(', '))
    expect(e30.noData.length).toBeGreaterThan(e30.noDataInWindow.length)
    expect(line(m30)).not.toContain('2026-07-12')
    const solo = buildUserMessage(requestFor(loadScenario('2026-10-12', 'solo30'), 'react'))
    expect(line(solo)).toBe('no-data days in the window (every package 0, npm gap): none')
  })
  it('sends the 6 strongest unusual days in day order', () => {
    const e = s.expected.packages['react']!
    const rows = msg
      .split('\n')
      .filter((l) => /^\d{4}-\d{2}-\d{2},\d+,[\d.]+,(spike|drop),/.test(l))
      .map((l) => l.split(',')[0])
    expect(rows).toEqual(e.top6)
    expect(rows).toHaveLength(6)
  })
  it('A1 and A0 are shown to 4 decimals', () => {
    expect(msg).toContain('daily averages (days with downloads above zero): A1=29367647.4643 (past month, n1=28); A0=24861690.1154 (month before, n0=26)')
    expect(msg).toMatch(/A1=\d+\.\d{4} A0=\d+\.\d{4}/)
  })
  it('the peers block lists every other package and not the target', () => {
    const peers = msg.split('peer packages (exact code aggregates, for comparison only):\n')[1]!.split('\n')
    expect(peers.map((l) => l.split(':')[0])).toEqual(['vite', 'zod', '@anthropic-ai/sdk'])
    expect(peers.every((l) => l.includes('window_total(window)=') && l.includes('A1='))).toBe(true)
  })
  it('only the earlier possible gaps are listed after the past month rows', () => {
    expect(msg).toContain('possible-gap days earlier in the window: 2026-06-03')
    const solo = loadScenario('2026-10-12', 'solo365')
    const m = buildUserMessage(requestFor(solo, 'react'))
    expect(m).toContain('possible-gap days earlier in the window: 2026-06-03, 2026-07-12')
  })
  it('flags the past month rows no-data and possible-gap', () => {
    expect(msg).toContain('\n2026-09-15,0,no-data\n')
    const solo = buildUserMessage(requestFor(loadScenario('2026-10-12', 'solo30'), 'react'))
    expect(solo).toContain('\n2026-09-15,0,possible-gap\n')
  })
  it('H5: with releases failed no row says "no release within" and every unusual row says "release data unavailable"', () => {
    const m = buildUserMessage(requestFor(s, 'react', 'failed'))
    expect(m).not.toContain('no release within')
    const unusualRows = m.split('\n').filter((l) => /^\d{4}-\d{2}-\d{2},\d+,[\d.]+,(spike|drop),/.test(l))
    expect(unusualRows).toHaveLength(6)
    for (const l of unusualRows) expect(l.endsWith(',release data unavailable')).toBe(true)
  })
  it('release wording follows the row', () => {
    const m = [...Object.values(s.rows)].length > 0 ? buildUserMessage(requestFor(s, 'vite')) : ''
    const wording = new Set(m.split('\n').filter((l) => /,(spike|drop),/.test(l)).map((l) => l.split(',').slice(4).join(',')))
    for (const w of wording) expect(['release same day', 'release 1 day(s) before', 'release 2 day(s) before', 'no release within 2 days']).toContain(w)
  })
  it('M5: growth not computable gives the sentence and no A1/A0 line', () => {
    const young = series('2026-09-17', 25, () => 500)
    const other = series('2026-08-01', 72, () => 800)
    const rows = { young, other }
    const window = computeWindow(rows, '2026-10-12', 30)
    const facts = computeFacts(rows, window, {}, { young: 'ok', other: 'ok' })
    const req: ExplainRequest = {
      target: 'young',
      names: ['young', 'other'],
      window,
      facts,
      pastRows: Object.fromEntries(facts.map((f) => [f.name, buildPastRows(rows[f.name as 'young'], window, f)])),
      releaseState: { young: 'ok', other: 'ok' },
    }
    const m = buildUserMessage(req)
    expect(m).toContain('growth: not computable (no downloads in the earlier period)')
    expect(m).not.toContain('daily averages')
    expect(m).toContain('other: window_total(window)=')
    const m2 = buildUserMessage({ ...req, target: 'other' })
    expect(m2).toContain('young: ')
    expect(m2).toContain('growth not computable')
    expect(m2).toContain('A1=')
  })
  it('says unusual days: none when there are none', () => {
    const m = buildUserMessage(requestFor(loadScenario('2026-10-12', 'r2'), 'vite'))
    expect(m).toContain('unusual days in the window: none')
    expect(m).not.toContain('strongest unusual days')
  })
})

describe('buildPastRows', () => {
  it('has the 30 past-month days with the flags', () => {
    const s = loadScenario('2026-10-12', 'r1')
    const w = computeWindow(s.rows, '2026-10-12', 365)
    const f = computeFacts(s.rows, w, s.releases, Object.fromEntries(s.names.map((n) => [n, 'ok' as const])))[0]!
    const rows = buildPastRows(s.rows['react'] as Rows, w, f)
    expect(rows).toHaveLength(30)
    expect(rows[0]).toEqual(['2026-09-11', 28799254, null])
    expect(rows.filter((r) => r[2] === 'no-data').map((r) => r[0])).toEqual(['2026-09-15', '2026-10-06'])
    expect(rows[29]).toEqual(['2026-10-10', 22046232, null])
  })
})

describe('SYSTEM_RULES', () => {
  // Golden: the rev 6 text sent live, plus exactly the rev 7 replacements (spec N1, N2, N6).
  const rev7 = (rev6: string, windowName: string): string =>
    rev6
      .replace(
        '1. Code formats every claim for display; you only set the claim fields.\n',
        '1. Code formats every claim for display; you only set the claim fields. What code renders: counts with commas; dates as D Mon YYYY; change_pct with one decimal and its % sign, so never write "percent" after it; a compare as a whole clause naming both packages and the period.\n',
      )
      .replace(
        'Round to one decimal, half away from zero, and give the sign (+12.3 or -4.1). ',
        'Write it to two decimals with its sign (+12.34 or -4.10) and do no further rounding. ',
      )
      .replace('the signed one-decimal number for change_pct', 'the signed two-decimal number for change_pct')
      .replace(
        'else empty.\n',
        "else empty. window_total and peak_value are positive whole numbers: where a package's total or peak is zero, write no claim for it and say in words that it had no downloads.\n",
      )
      .replace(
        "5. Every comparison between packages is a compare claim {package, peer, metric, relation}; code writes its words. Text segments never say which package is larger, smaller, faster, slower, ahead or behind.\n",
        `5. Every comparison between packages is a compare claim {package, peer, metric, relation}; code writes its words. Text segments never say which package is larger, smaller, faster, slower, ahead or behind. A compare is a complete clause written by code (for example "react's total for ${windowName} is higher than zod's"): put it in its own sentence, with nothing around it that repeats its sense, and never add a figure claim to stand for a comparison.\n`,
      )
  it('is the live text plus the rev 7 replacements, for a year and a month window', () => {
    expect(SYSTEM_RULES('the past year', 'react')).toBe(rev7(loadGolden('system-rev6-r1-react.txt'), 'the past year'))
    expect(SYSTEM_RULES('the past month', 'vite')).toBe(rev7(loadGolden('system-rev6-r2-vite.txt'), 'the past month'))
  })
  it('tells the model to write no total or peak claim for a zero, and to say so in words', () => {
    const rule = SYSTEM_RULES('the past year', 'react').split('\n').find((l) => l.startsWith('4. '))!
    expect(rule).toContain('window_total and peak_value are positive whole numbers')
    expect(rule).toContain('write no claim for it and say in words that it had no downloads')
  })
  it('the replacements all applied', () => {
    const t = SYSTEM_RULES('the past year', 'react')
    expect(t).not.toContain('one decimal, half away')
    expect(t).not.toContain('signed one-decimal')
    expect(t).toContain('so never write "percent" after it')
    expect(t).toContain('Write one paragraph about react, at most 120 words')
  })
})

describe('CLAIM_SCHEMA', () => {
  it('is the schema accepted live (judge r6 pattern probe) with the two-decimal change_pct pattern', () => {
    const names = ['react', 'vite', 'zod', '@anthropic-ai/sdk']
    const live = loadGoldenJson<{ properties: { paragraph: { items: { anyOf: Array<{ properties: { kind?: { enum: string[] }; value?: { pattern: string } } }> } } } }>('schema-r1p-react.json')
    const branch = live.properties.paragraph.items.anyOf.find((b) => b.properties.kind?.enum.join() === 'change_pct')!
    expect(branch.properties.value!.pattern).toBe('^[+-][0-9]+[.][0-9]$')
    branch.properties.value!.pattern = '^[+-][0-9]+[.][0-9]{2}$'
    // Step 0.5: the model wrote 0 as a placeholder for a total and a peak, so those two kinds take a positive integer.
    const totals = live.properties.paragraph.items.anyOf.find((b) => b.properties.kind?.enum.join() === 'window_total,peak_value')!
    expect(totals.properties.value!.pattern).toBe('^[0-9]+$')
    totals.properties.value!.pattern = '^[1-9][0-9]*$'
    expect(CLAIM_SCHEMA(names)).toEqual(live)
  })
  it('the window_total and peak_value pattern refuses 0 and a leading zero, and keeps day_value open to 0', () => {
    const anyOf = (CLAIM_SCHEMA(['a']) as { properties: { paragraph: { items: { anyOf: Array<{ properties: { kind?: { enum: string[] }; value?: { pattern: string } } }> } } } }).properties.paragraph.items.anyOf
    const re = (kind: string) => new RegExp(anyOf.find((b) => b.properties.kind?.enum.includes(kind))!.properties.value!.pattern)
    for (const kind of ['window_total', 'peak_value']) {
      expect(re(kind).test('0'), kind).toBe(false)
      expect(re(kind).test('007'), kind).toBe(false)
      for (const good of ['5', '10', '67807579']) expect(re(kind).test(good), `${kind} ${good}`).toBe(true)
    }
    expect(re('day_value').test('0')).toBe(true)
  })
  it('has a text branch, four per-kind claim branches and a compare branch', () => {
    const items = (CLAIM_SCHEMA(['a', 'b']) as { properties: { paragraph: { items: { anyOf: unknown[] } } } }).properties.paragraph.items.anyOf
    expect(items).toHaveLength(6)
  })
})

describe('a package with no downloads in the window', () => {
  const rows = { quiet: series('2025-09-01', 400, () => 0), busy: series('2025-09-01', 400, () => 500) }
  const window = computeWindow(rows, '2026-10-12', 30)
  const facts = computeFacts(rows, window, {}, { quiet: 'ok', busy: 'ok' })
  const req = (target: string): ExplainRequest => ({
    target,
    names: [target, ...['quiet', 'busy'].filter((n) => n !== target)],
    window,
    facts: [target, ...['quiet', 'busy'].filter((n) => n !== target)].map((n) => facts.find((f) => f.name === n)!),
    pastRows: { [target]: buildPastRows(rows[target as 'quiet'], window, facts.find((f) => f.name === target)!) },
    releaseState: { quiet: 'ok', busy: 'ok' },
  })
  it('has zero totals and a growth that is not computable, as facts', () => {
    const f = facts.find((x) => x.name === 'quiet')!
    expect(f.aggregates.windowTotal).toBe(0n)
    expect(f.aggregates.peakValue).toBe(0)
    expect(f.aggregates.growth.computable).toBe(false)
  })
  it('still gets a user message the model can answer, as target and as peer', () => {
    const own = buildUserMessage(req('quiet'))
    expect(own).toContain('window_total(window)=0')
    expect(own).toContain('growth: not computable')
    const peer = buildUserMessage(req('busy'))
    expect(peer).toContain('quiet: window_total(window)=0')
    expect(peer).toContain('growth not computable')
  })
})

describe('request encoding', () => {
  it('round-trips bigint totals exactly', () => {
    const s = loadScenario('2026-10-12', 'r2')
    const req = requestFor(s, 'vite')
    const text = encodeRequest(req)
    expect(() => JSON.parse(text)).not.toThrow()
    const plain = JSON.parse(text).facts[0].aggregates
    expect([plain.windowTotal, plain.last30Total, plain.growth.S1, plain.growth.S0].every((v) => typeof v === 'string' && /^[0-9]+$/.test(v))).toBe(true)
    const back = decodeRequest(text)
    expect(back).toEqual(req)
    expect(typeof back.facts[0]!.aggregates.windowTotal).toBe('bigint')
  })
  it('rejects a bigint field that is not a decimal string', () => {
    const bad = JSON.parse(encodeRequest(requestFor(loadScenario('2026-10-12', 'r2'), 'vite')))
    bad.facts[0].aggregates.windowTotal = 'x1'
    expect(() => decodeRequest(JSON.stringify(bad))).toThrow()
  })
  it('keeps a total past 2^53', () => {
    const s = loadScenario('2026-10-12', 'r2')
    const req = requestFor(s, 'vite')
    req.facts[0]!.aggregates.windowTotal = 9007199254740993n
    expect(decodeRequest(encodeRequest(req)).facts[0]!.aggregates.windowTotal).toBe(9007199254740993n)
  })
})
