import { describe, expect, it } from 'vitest'
import { computeFacts } from '../../shared/aggregates'
import { CLAIM_SCHEMA, SYSTEM_RULES, buildPastRows, buildUserMessage, decodeRequest, encodeRequest } from '../../shared/modelInput'
import { topUnusual } from '../../shared/unusual'
import { computeWindow } from '../../shared/window'
import type { ExplainRequest, Release, ReleaseState, Rows } from '../../shared/types'
import { fname, loadGolden, loadGoldenJson, loadScenario, series } from '../fixtures/load'
import type { Scenario } from '../fixtures/load'

function requestFor(s: Pick<Scenario, 'names' | 'rows' | 'releases' | 'date' | 'days'>, target: string, state: ReleaseState = 'ok'): ExplainRequest {
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

/** The direction word for a package, from expected.json (computed by compute_expected.py, not by the code under test). */
const word = (change1: string | null): string => (change1 === null ? 'not computable' : change1.startsWith('-') ? 'fell' : change1 === '+0.0' ? 'was flat' : 'rose')
const CODE_SHOWS = '(code computes and shows the figure; write a change_pct claim with an empty value where it goes)'

/**
 * The goldens are the rev 6 messages sent live (Step 0r6); no script writes them. Rev 8 (GA.6) changes exactly the growth
 * lines: the target's A1/A0 line becomes its direction word, and each peer's A1/A0 tail becomes the peer's direction word.
 */
function rev8(golden: string, s: Scenario, target: string): string {
  return golden
    .replace(/^daily averages \(days with downloads above zero\): A1=.*$/m, `growth: ${word(s.expected.packages[target]!.change1)} ${CODE_SHOWS}`)
    .replace(/^(.+?): (window_total.*?); A1=\S+ A0=\S+$/gm, (_m, name: string, head: string) => `${name}: ${head}; growth ${word(s.expected.packages[name]!.change1)}`)
}

describe('buildUserMessage is the messages sent in the live runs, with only the rev 8 growth lines changed', () => {
  const cases: Array<[string, string, ReleaseState]> = [
    ['r1', 'r1', 'ok'],
    ['r2', 'r2', 'ok'],
    ['r3', 'r3', 'ok'],
    ['r1u', 'r1', 'failed'],
  ]
  for (const [golden, key, state] of cases) {
    const s = loadScenario('2026-10-12', key)
    for (const target of s.names)
      it(`${golden} ${target}: golden plus the growth lines`, () => {
        expect(buildUserMessage(requestFor(s, target, state))).toBe(rev8(loadGolden(`user-${golden}-${fname(target)}.txt`), s, target))
      })
  }
})

describe('buildUserMessage is the rev 8 message sent live (Step 0.5, r1 react)', () => {
  // Step 0.5 fetched npm one day after the 2026-10-12 fixtures, so its own npm and release captures are the input (golden/rev8-r1).
  it('is byte for byte the captured user message, built from the captured npm and release responses', () => {
    const names = ['react', 'vite', 'zod', '@anthropic-ai/sdk']
    const rows = Object.fromEntries(
      names.map((n) => [n, Object.fromEntries((JSON.parse(loadGolden(`rev8-r1/npm-${fname(n)}.txt`).split('\n')[1]!) as { downloads: Array<{ day: string; downloads: number }> }).downloads.map((r) => [r.day, r.downloads]))]),
    ) as Record<string, Rows>
    const releases = Object.fromEntries(names.map((n) => [n, loadGoldenJson<{ releases: Release[] }>(`rev8-r1/releases-${fname(n)}.json`).releases]))
    expect(buildUserMessage(requestFor({ names, rows, releases, date: '2026-10-12', days: 365 }, 'react'))).toBe(loadGolden('user-rev8-react.txt'))
  })
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
  it('F3: the growth line gives a direction word and no digit, and no A1 or A0 line exists anywhere', () => {
    const line = msg.split('\n').find((l) => l.startsWith('growth: '))!
    expect(line).toBe(`growth: ${word(s.expected.packages['react']!.change1)} ${CODE_SHOWS}`)
    expect(line).not.toMatch(/\d/)
    expect(msg).not.toMatch(/A1|A0|daily averages/)
  })
  it('the peers block lists every other package and not the target, each with a direction word and no digit', () => {
    const peers = msg.split('peer packages (exact code aggregates, for comparison only):\n')[1]!.split('\n')
    expect(peers.map((l) => l.split(':')[0])).toEqual(['vite', 'zod', '@anthropic-ai/sdk'])
    for (const l of peers) {
      const name = l.split(':')[0]!
      expect(l.includes('window_total(window)=')).toBe(true)
      expect(l.endsWith(`; growth ${word(s.expected.packages[name]!.change1)}`)).toBe(true)
      expect(l.split('; growth')[1]).not.toMatch(/\d/)
    }
  })
  it('F3: fell, was flat and rose, from the one-decimal figure (a fall that rounds to zero is flat)', () => {
    const growthWord = (a: number, b: number): string => {
      const rows = { t: series('2026-08-01', 72, (_i, day) => (day >= '2026-09-12' ? a : day >= '2026-08-13' ? b : 0)), o: series('2026-08-01', 72, () => 800) }
      const window = computeWindow(rows, '2026-10-12', 30)
      const facts = computeFacts(rows, window, {}, { t: 'ok', o: 'ok' })
      const m = buildUserMessage({ target: 't', names: ['t', 'o'], window, facts, pastRows: { t: buildPastRows(rows.t, window, facts[0]!) }, releaseState: { t: 'ok', o: 'ok' } })
      return m.split('\n').find((l) => l.startsWith('growth: '))!.split(' (')[0]!
    }
    expect(growthWord(9000, 10000)).toBe('growth: fell')
    expect(growthWord(10000, 10000)).toBe('growth: was flat')
    expect(growthWord(99_999, 100_000)).toBe('growth: was flat')
    expect(growthWord(11000, 10000)).toBe('growth: rose')
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
    expect(m).not.toMatch(/daily averages|A1|A0|growth: (rose|fell|was flat)/)
    expect(m).toMatch(/^other: window_total\(window\)=.*; growth was flat$/m)
    const m2 = buildUserMessage({ ...req, target: 'other' })
    expect(m2).toContain('young: ')
    expect(m2).toContain('growth not computable')
    expect(m2).toContain('growth: was flat (code computes')
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
  // Golden: the rev 6 text sent live, plus exactly the rev 7 replacements (spec N1, N2, N6) and the rev 8 ones (G1, G2, F3).
  const rev8Rules = (rev6: string, windowName: string): string =>
    rev6
      .replace(
        '1. Code formats every claim for display; you only set the claim fields.\n',
        '1. Code formats every claim for display; you only set the claim fields. What code renders: counts with commas; dates as D Mon YYYY; change_pct with one decimal and its % sign, so never write "percent" after it; a compare as a whole clause naming both packages and the period.\n',
      )
      .replace(
        'Code has already computed the exact aggregates (totals, peaks, daily averages) and found the unusual days; trust them. Your job is the reasoning: state and explain growth, compare the packages, and explain the unusual days.',
        'Code has already computed the exact aggregates (totals, peaks), growth and the comparisons, and found the unusual days; trust them. Your job is the words: explain the unusual days, name which packages to compare, and say what the input states about growth.',
      )
      .replace(
        /^2\. Growth: .*$/m,
        '2. Growth is a change_pct claim with an empty value; code shows the figure. Never write a growth figure. Say rose, fell or flat only as the input states it. If the input says growth is not computable, write no change_pct claim and say growth cannot be computed.',
      )
      .replace('the signed one-decimal number for change_pct', 'empty for change_pct (code fills it)')
      .replace(
        'else empty.\n',
        "else empty. window_total and peak_value are positive whole numbers: where a package's total or peak is zero, write no claim for it and say in words that it had no downloads.\n",
      )
      .replace(
        "5. Every comparison between packages is a compare claim {package, peer, metric, relation}; code writes its words. Text segments never say which package is larger, smaller, faster, slower, ahead or behind.\n",
        `5. Every comparison between packages is a compare claim {package, peer, metric}; code decides higher or lower and writes its words. Text segments never say which package is larger, smaller, faster, slower, ahead or behind. A compare is a complete clause written by code (for example "react's total for ${windowName} is higher than zod's"): put it in its own sentence, with nothing around it that repeats its sense, and never add a figure claim to stand for a comparison.\n`,
      )
  // Rev 8.3 (SP2 fixes): a window length is a window_days claim, and figure claims are about the target only.
  const rev83 = (rules: string, target: string): string =>
    rules
      .replace(
        'Never count days.\n',
        'Where you say how many days a period covers, write a window_days claim (span window for the whole window, last30 for the past month), never digits or a number word in text.\n',
      )
      .replace(
        'window_total (span window or last30; copy the given total), ',
        'window_total (span window or last30; copy the given total), window_days (span window or last30; the number of days that period covers, digits only), ',
      )
      .replace(
        "Cite a peer's figure at most once.\n",
        `Write figure claims only about ${target}; peers appear only in compare claims. State each figure once.\n`,
      )
      .replace('baselines, counts of days, version', 'baselines, counts of days other than a window length (a window_days claim), version')
  it('is the live text plus the rev 7, rev 8 and rev 8.3 replacements, for a year and a month window', () => {
    expect(SYSTEM_RULES('the past year', 'react')).toBe(rev83(loadGolden('system-rev8.txt'), 'react')) // the capture, Step 0.5
    expect(SYSTEM_RULES('the past month', 'vite')).toBe(rev83(rev8Rules(loadGolden('system-rev6-r2-vite.txt'), 'the past month'), 'vite'))
  })
  it('rev 8.3: the rules ask for window_days and no longer say "Never count days" or "Cite a peer\'s figure"', () => {
    const t = SYSTEM_RULES('the past month', 'vite')
    expect(t).toContain('write a window_days claim')
    expect(t).not.toContain('Never count days.')
    expect(t).toContain('Write figure claims only about vite; peers appear only in compare claims')
    expect(t).not.toContain("Cite a peer's figure")
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
    expect(t).not.toMatch(/two-decimal|two decimals|A1|A0|daily averages|relation/)
    expect(t).toContain('so never write "percent" after it')
    expect(t).toContain('Write one paragraph about react, at most 120 words')
  })
  it('G1 and F3: the intro, rule 2 and rule 4 say code shows the growth figure and the value is empty', () => {
    const t = SYSTEM_RULES('the past year', 'react')
    expect(t).toContain('Your job is the words: explain the unusual days, name which packages to compare, and say what the input states about growth.')
    expect(t).toContain('Growth is a change_pct claim with an empty value; code shows the figure. Never write a growth figure.')
    expect(t).not.toContain('do not say whether it rose or fell')
    expect(t).toContain('empty for change_pct')
  })
})

describe('CLAIM_SCHEMA', () => {
  type Branch = { properties: { kind?: { enum: string[] }; span?: { enum: string[] }; value?: { pattern: string } } }
  const branches = (names: string[]) => (CLAIM_SCHEMA(names) as { properties: { paragraph: { items: { anyOf: Branch[] } } } }).properties.paragraph.items.anyOf
  it('is the rev 8 schema accepted live (Step 0.5, r1 react), with the rev 8.3 branches: window_total and window_days take no span none', () => {
    const live = loadGoldenJson<{ properties: { paragraph: { items: { anyOf: Array<Record<string, any>> } } } }>('schema-rev8-react.json') // eslint-disable-line @typescript-eslint/no-explicit-any
    const items = live.properties.paragraph.items.anyOf
    const totals = items.find((b) => b.properties.kind?.enum.includes('window_total'))!
    const peak = structuredClone(totals)
    peak.properties.kind.enum = ['peak_value']
    totals.properties.kind.enum = ['window_total', 'window_days']
    totals.properties.span.enum = ['window', 'last30']
    items.splice(items.indexOf(totals) + 1, 0, peak)
    expect(CLAIM_SCHEMA(['react', 'vite', 'zod', '@anthropic-ai/sdk'])).toEqual(live)
  })
  it('rev 8.3: span none is refused for window_total and window_days, and kept for the kinds that need no span', () => {
    const b = branches(['a'])
    const spans = (kind: string) => b.find((x) => x.properties.kind?.enum.includes(kind))!.properties.span!.enum
    expect(spans('window_total')).toEqual(['window', 'last30'])
    expect(spans('window_days')).toEqual(['window', 'last30'])
    expect(spans('day_value')).toContain('none')
    expect(spans('peak_value')).toContain('none')
  })
  it('rev 8.3: a window_days value is a positive whole number', () => {
    const re = new RegExp(branches(['a']).find((x) => x.properties.kind?.enum.includes('window_days'))!.properties.value!.pattern)
    for (const bad of ['0', '007', '', '3.5']) expect(re.test(bad), bad).toBe(false)
    for (const good of ['30', '90', '365']) expect(re.test(good), good).toBe(true)
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
  it('has a text branch, five per-kind claim branches and a compare branch', () => {
    const items = (CLAIM_SCHEMA(['a', 'b']) as { properties: { paragraph: { items: { anyOf: unknown[] } } } }).properties.paragraph.items.anyOf
    expect(items).toHaveLength(7)
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
