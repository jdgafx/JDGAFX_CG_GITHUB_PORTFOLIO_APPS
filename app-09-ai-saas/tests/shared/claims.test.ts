import { describe, expect, it } from 'vitest'
import { figureNumbers, judge, renderClaim, renderCompare, validateShape } from '../../shared/claims'
import { computeWindow } from '../../shared/window'
import type { FigureKind, Segment } from '../../shared/types'
import { loadScenario, series } from '../fixtures/load'

type Claim = Extract<Segment, { t: 'claim' }>
type Compare = Extract<Segment, { t: 'compare' }>
const claim = (kind: FigureKind, pkg: string, value: string, over: Partial<Claim> = {}): Claim => ({
  t: 'claim',
  kind,
  package: pkg,
  span: 'none',
  day: '',
  value,
  ...over,
})
const cmp = (pkg: string, peer: string, metric: Compare['metric'], relation: Compare['relation']): Compare => ({ t: 'compare', package: pkg, peer, metric, relation })
const text = (s: string): Segment => ({ t: 'text', s })

const r2 = loadScenario('2026-10-12', 'r2')
const w2 = computeWindow(r2.rows, '2026-10-12', 30)
const r1 = loadScenario('2026-10-12', 'r1')
const w1 = computeWindow(r1.rows, '2026-10-12', 365)
const verdictOf = (seg: Segment, s = r2, w = w2) => judge([seg], s.rows, w, s.days)[0]!

describe('H4: compare claims are recomputed', () => {
  it('esbuild vs vite window_total: lower is wrong, higher is checked (10-12 fixture)', () => {
    expect(verdictOf(cmp('esbuild', 'vite', 'window_total', 'lower'))).toMatchObject({ verdict: 'wrong', reason: 'differs' })
    expect(verdictOf(cmp('esbuild', 'vite', 'window_total', 'higher')).verdict).toBe('checked')
  })
  it('a wrong compare carries the true relation as its npm value', () => {
    expect(verdictOf(cmp('esbuild', 'vite', 'window_total', 'lower')).npmValue).toBe("esbuild's total for the past month is higher than vite's")
  })
  it('zod vs vite change_pct: lower is wrong, higher is checked', () => {
    expect(verdictOf(cmp('zod', 'vite', 'change_pct', 'lower'), r1, w1).verdict).toBe('wrong')
    expect(verdictOf(cmp('zod', 'vite', 'change_pct', 'higher'), r1, w1).verdict).toBe('checked')
  })
  it('last30_total and peak_value compare on the exact figures', () => {
    expect(verdictOf(cmp('zod', 'react', 'last30_total', 'higher'), r1, w1).verdict).toBe('checked')
    expect(verdictOf(cmp('zod', 'react', 'peak_value', 'lower'), r1, w1).verdict).toBe('wrong')
  })
  it('a tie is wrong whichever relation is claimed, and peer = package is wrong', () => {
    const rows = { a: series('2026-08-01', 72, () => 500), b: series('2026-08-01', 72, () => 500) }
    const w = computeWindow(rows, '2026-10-12', 30)
    for (const relation of ['higher', 'lower'] as const) expect(judge([cmp('a', 'b', 'window_total', relation)], rows, w, 30)[0]).toMatchObject({ verdict: 'wrong', reason: 'tie' })
    expect(verdictOf(cmp('vite', 'vite', 'window_total', 'higher'))).toMatchObject({ verdict: 'wrong', reason: 'same package' })
  })
  it('a not-computable change is wrong', () => {
    const rows = { a: series('2026-09-17', 25, () => 500), b: series('2026-08-01', 72, () => 500) }
    const w = computeWindow(rows, '2026-10-12', 30)
    expect(judge([cmp('a', 'b', 'change_pct', 'higher')], rows, w, 30)[0]).toMatchObject({ verdict: 'wrong', reason: 'no basis' })
  })
})

describe('rendering', () => {
  it('claim text equals the formatted value', () => {
    expect(renderClaim(claim('window_total', 'vite', '5765986637', { span: 'window' }))).toBe('5,765,986,637')
    expect(renderClaim(claim('peak_value', 'vite', '39379494'))).toBe('39,379,494')
    expect(renderClaim(claim('day_value', 'vite', '38105740', { day: '2026-10-01' }))).toBe('38,105,740')
    expect(renderClaim(claim('peak_day', 'vite', '2026-10-01'))).toBe('1 Oct 2026')
    expect(renderClaim(claim('unusual_day', 'vite', '2026-02-22'))).toBe('22 Feb 2026')
    expect(renderClaim(claim('day', 'vite', '2026-09-15'))).toBe('15 Sep 2026')
    expect(renderClaim(claim('change_pct', 'vite', '+34.07'))).toBe('+34.1%')
    expect(renderClaim(claim('change_pct', 'vite', '+18.12'))).toBe('+18.1%')
  })
  it('an empty or malformed value renders (no value)', () => {
    for (const [kind, v] of [['window_total', ''], ['peak_value', '12.5'], ['peak_day', 'x'], ['day', ''], ['unusual_day', '2026-13-40'], ['change_pct', '+34.1'], ['day_value', 'a']] as const)
      expect(renderClaim(claim(kind, 'vite', v, { day: '2026-10-01' }))).toBe('(no value)')
  })
  it('N6: compare wording takes the window name and has no digits', () => {
    expect(renderCompare(cmp('zod', 'react', 'window_total', 'higher'), 'the past year')).toBe("zod's total for the past year is higher than react's")
    expect(renderCompare(cmp('zod', 'react', 'window_total', 'lower'), 'the past month')).toBe("zod's total for the past month is lower than react's")
    expect(renderCompare(cmp('zod', 'react', 'last30_total', 'higher'), 'the past year')).toBe("zod's total for the past month is higher than react's")
    expect(renderCompare(cmp('zod', 'vite', 'change_pct', 'higher'), 'the past year')).toBe('zod grew faster than vite over the past month')
    expect(renderCompare(cmp('zod', 'vite', 'change_pct', 'lower'), 'the past year')).toBe('zod grew slower than vite over the past month')
    expect(renderCompare(cmp('zod', 'react', 'peak_value', 'higher'), 'the past three months')).toBe("zod's busiest day in the past three months was higher than react's")
    expect(renderCompare(cmp('zod', 'react', 'peak_value', 'lower'), 'the past year')).toBe("zod's busiest day in the past year was lower than react's")
  })
  it('judge renders each entry', () => {
    const j = judge([text('hello'), claim('window_total', 'vite', '844053932', { span: 'last30' }), cmp('esbuild', 'vite', 'window_total', 'higher')], r2.rows, w2, 30)
    expect(j.map((x) => x.rendered)).toEqual(['hello', '844,053,932', "esbuild's total for the past month is higher than vite's"])
    expect(j.map((x) => x.verdict)).toEqual(['neutral', 'checked', 'checked'])
  })
})

describe('verdicts', () => {
  it('an empty value is wrong (value form) and renders (no value)', () => {
    expect(verdictOf(claim('window_total', 'vite', '', { span: 'window' }))).toMatchObject({ verdict: 'wrong', reason: 'value form', rendered: '(no value)' })
  })
  it('day different from value on a date kind is wrong', () => {
    expect(verdictOf(claim('unusual_day', 'webpack', '2026-09-19', { day: '2026-09-20' }), r2, w2)).toMatchObject({ verdict: 'wrong', reason: 'day differs from value' })
  })
  it('a wrong figure shows the model value and keeps the npm value apart (N3)', () => {
    const e = r2.expected.packages['vite']!
    const j = verdictOf(claim('window_total', 'vite', String(BigInt(e.windowTotal) + 1n), { span: 'window' }))
    expect(j.verdict).toBe('wrong')
    expect(j.rendered).toBe(String(BigInt(e.windowTotal) + 1n).replace(/\B(?=(\d{3})+(?!\d))/g, ','))
    expect(j.npmValue).toBe(BigInt(e.windowTotal).toLocaleString('en-US'))
  })
  it('npm values are formatted like the marks (counts, dates, percent)', () => {
    const e = r2.expected.packages['vite']!
    expect(e.peakDay).toBe('2026-10-01')
    expect(verdictOf(claim('peak_day', 'vite', '2026-09-20', { span: 'window' })).npmValue).toBe('1 Oct 2026')
    expect(verdictOf(claim('peak_value', 'vite', '5')).npmValue).toBe(e.peakValue.toLocaleString('en-US'))
    expect(verdictOf(claim('change_pct', 'vite', '+19.04')).npmValue).toBe('+19.0%')
  })
  it('a day claim in the window is neutral, never checked', () => {
    expect(verdictOf(claim('day', 'vite', '2026-09-20')).verdict).toBe('neutral')
  })
})

describe('numeral pass', () => {
  it('an undeclared 246,877 in text is unchecked, with its position', () => {
    const j = verdictOf(text('It had 246,877 downloads.'))
    expect(j.verdict).toBe('unchecked')
    expect(j.runs).toEqual([{ start: 7, end: 14 }])
    expect(j.rendered).toBe('It had 246,877 downloads.')
  })
  it('text without a digit is neutral; the text renders byte-identical', () => {
    const s = '  odd   spacing\nand a newline '
    expect(verdictOf(text(s))).toMatchObject({ verdict: 'neutral', rendered: s })
  })
  it('the selected names own digits are exempt by position (d3), other digits are not', () => {
    const rows = { d3: series('2026-08-01', 72, () => 500), vue: series('2026-08-01', 72, () => 400) }
    const w = computeWindow(rows, '2026-10-12', 30)
    const unchecked = (s: string) => judge([text(s)], rows, w, 30)[0]!.verdict === 'unchecked'
    expect(unchecked('d3 grew faster, and d3, d3. and d3\'s trend held')).toBe(false)
    expect(unchecked('vue3 grew faster')).toBe(true)
    expect(unchecked('d3 had 5 spikes')).toBe(true)
    expect(unchecked('d33 grew')).toBe(true)
  })
  it('flags digits of any script: Arabic-Indic, fullwidth, Devanagari and mathematical digits', () => {
    for (const digits of ['\u0663\u0664', '\uFF13\uFF14', '\u096B', '\u{1D7D9}\u{1D7DA}']) {
      const s = `It had ${digits} downloads.`
      const j = verdictOf(text(s))
      expect(j.verdict, digits).toBe('unchecked')
      expect(s.slice(j.runs![0]!.start, j.runs![0]!.end), digits).toBe(digits)
    }
    expect(verdictOf(text('It had \u0663,\u0664\u0665 downloads.')).runs).toEqual([{ start: 7, end: 11 }])
  })
  it('a decimal and a trailing full stop form one run', () => {
    const j = verdictOf(text('about 3.5 million in 2026.'))
    expect(j.runs).toEqual([{ start: 6, end: 9 }, { start: 21, end: 26 }])
  })
})

describe('M3: shape limits', () => {
  const claims = (n: number): Segment[] => Array.from({ length: n }, () => claim('day', 'vite', '2026-09-20'))
  it('1,000 and 1,500 characters are valid; 1,501 is invalid', () => {
    expect(validateShape([text('a'.repeat(1000))])).toEqual({ ok: true })
    expect(validateShape([text('a'.repeat(1500))])).toEqual({ ok: true })
    const r = validateShape([text('a'.repeat(1501))])
    expect(r.ok).toBe(false)
  })
  it('the limit counts all text segments together', () => {
    expect(validateShape([text('a'.repeat(800)), claim('day', 'vite', '2026-09-20'), text('b'.repeat(701))]).ok).toBe(false)
  })
  it('12 claims are valid, 13 invalid; a compare counts as a claim', () => {
    expect(validateShape(claims(12))).toEqual({ ok: true })
    expect(validateShape(claims(13)).ok).toBe(false)
    expect(validateShape([...claims(11), cmp('a', 'b', 'window_total', 'higher')])).toEqual({ ok: true })
    expect(validateShape([...claims(12), cmp('a', 'b', 'window_total', 'higher')]).ok).toBe(false)
  })
  it('failure reasons carry no digit (they print inside the explanation region)', () => {
    for (const r of [validateShape(claims(13)), validateShape([text('a'.repeat(1501))]), validateShape(null)]) expect(r.ok === false && /\d/.test(r.reason)).toBe(false)
  })
  it('the failure carries a reason; a non-array or malformed segment is a bad shape', () => {
    const r = validateShape(claims(13))
    expect(r).toEqual({ ok: false, reason: 'the paragraph made too many claims' })
    expect(validateShape([text('a'.repeat(1501))])).toEqual({ ok: false, reason: 'the paragraph was too long' })
    for (const bad of [null, {}, 'x', [{ t: 'text' }], [{ t: 'claim', kind: 'nope', package: 'a', span: 'none', day: '', value: '' }], [{ t: 'other' }], [null]])
      expect(validateShape(bad)).toEqual({ ok: false, reason: 'bad shape' })
  })
})

describe('N4: figure numbering', () => {
  const count = claim('window_total', 'vite', '844053932', { span: 'last30' })
  it('skips compares, (no value) marks and dates; figure 1 is the first count', () => {
    const p: Segment[] = [
      text('Intro. '),
      cmp('vite', 'webpack', 'window_total', 'higher'),
      claim('window_total', 'vite', '', { span: 'window' }),
      claim('peak_day', 'vite', '2026-10-01', { span: 'window' }),
      claim('day', 'vite', '2026-09-20'),
      count,
      claim('change_pct', 'vite', '+19.04'),
    ]
    expect(figureNumbers([p])).toEqual([
      { paragraph: 0, segment: 5 },
      { paragraph: 0, segment: 6 },
    ])
  })
  it('reads in order across paragraphs; a wrong figure still counts', () => {
    const wrongCount = claim('peak_value', 'vite', '1')
    const out = figureNumbers([[text('x'), wrongCount], [claim('unusual_day', 'zod', '2026-01-01'), count, claim('day_value', 'zod', '7', { day: '2026-09-20' })]])
    expect(out).toEqual([
      { paragraph: 0, segment: 1 },
      { paragraph: 1, segment: 1 },
      { paragraph: 1, segment: 2 },
    ])
  })
  it('is empty without figures', () => {
    expect(figureNumbers([[text('only words')], []])).toEqual([])
  })
})
