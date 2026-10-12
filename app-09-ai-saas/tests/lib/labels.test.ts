import { describe, expect, it } from 'vitest'
import type { Judged } from '../../shared/claims'
import type { Segment } from '../../shared/types'
import { parseParagraph } from '../../netlify/shared/boundary'
import { checkRows, closingStop, labelFor, separatorBetween, type Shown } from '../../src/lib/labels'
import captured from '../fixtures/sp2-e2ed80c-paragraphs.json'
import { stubFacts, stubWindow } from '../ui/stubCore'

const claim = (kind: string, value: string, extra: Partial<Extract<Segment, { t: 'claim' }>> = {}): Segment =>
  ({ t: 'claim', kind, package: 'vite', span: 'window', day: '', value, ...extra }) as Segment
const compare = (): Segment => ({ t: 'compare', package: 'vite', peer: 'zod', metric: 'window_total', relation: 'higher' })
const unsetCompare = (): Segment => ({ t: 'compare', package: 'vite', peer: 'zod', metric: 'change_pct' })
const ctx = { window: stubWindow('2026-10-12', 30), facts: [stubFacts('vite', 0), stubFacts('zod', 0)] }
const rowFor = (j: Judged) => checkRows([{ name: 'vite', judged: [j] } satisfies Shown], [], ctx, {})[0]!

describe('model value cell of the figure check (GA.6)', () => {
  it('reads "computed by code" for a compare and a change_pct, whatever the filled field holds', () => {
    expect(rowFor({ seg: compare(), verdict: 'checked', rendered: 'x', npmValue: 'x' }).modelValue).toBe('computed by code')
    expect(rowFor({ seg: unsetCompare(), verdict: 'wrong', rendered: '(no comparison)', reason: 'tie', npmValue: 'equal' }).modelValue).toBe('computed by code')
    expect(rowFor({ seg: claim('change_pct', '+18.10'), verdict: 'checked', rendered: '+18.1%', npmValue: '+18.1%' }).modelValue).toBe('computed by code')
  })
  it('still shows the model value of a copied figure', () => {
    expect(rowFor({ seg: claim('window_total', '5'), verdict: 'wrong', rendered: '5', npmValue: '7,000', reason: 'differs' }).modelValue).toBe('5')
  })
})

describe('npm value cell of the figure check', () => {
  it('shows the reason, never the model value, for a wrong claim that has no npm value', () => {
    const reasons = ['no-data day', 'possible gap', 'outside window', 'value form', 'no basis', 'not in the unusual set']
    for (const reason of reasons) {
      const row = rowFor({ seg: claim('day_value', '123456', { day: '2026-09-20' }), verdict: 'wrong', rendered: '123,456', reason })
      expect(row.modelValue).toBe('123456')
      expect(row.npmValue, reason).toBe(reason)
    }
    const compared = rowFor({ seg: compare(), verdict: 'wrong', rendered: 'x', reason: 'no basis' })
    expect(compared.npmValue).toBe('no basis')
  })
  it('shows the npm value when there is one, for a wrong or a checked claim', () => {
    expect(rowFor({ seg: claim('window_total', '5'), verdict: 'wrong', rendered: '5', npmValue: '7,000', reason: 'differs' }).npmValue).toBe('7,000')
    expect(rowFor({ seg: claim('window_total', '7000'), verdict: 'checked', rendered: '7,000', npmValue: '7,000' }).npmValue).toBe('7,000')
  })
  it('a checked claim with no npm value (an unusual day in the set) shows its own value; others show nothing', () => {
    expect(rowFor({ seg: claim('unusual_day', '2026-09-12', { day: '2026-09-12' }), verdict: 'checked', rendered: '12 Sep 2026' }).npmValue).toBe('2026-09-12')
    expect(rowFor({ seg: claim('day', '2026-09-12'), verdict: 'neutral', rendered: '12 Sep 2026' }).npmValue).toBe('')
  })
})

const textJ = (s: string): Judged => ({ seg: { t: 'text', s }, verdict: 'neutral', rendered: s })
const claimJ = (): Judged => ({ seg: claim('window_total', '5'), verdict: 'checked', rendered: '5' })
const compareJ = (): Judged => ({ seg: compare(), verdict: 'checked', rendered: "vite's total for the past month is higher than zod's" })

describe('separatorBetween: a space or sentence break where the model left none', () => {
  it('adds nothing when the text already carries the break', () => {
    expect(separatorBetween(textJ('A sentence. '), compareJ())).toBe('')
    expect(separatorBetween(textJ('A sentence.'), textJ(' More'))).toBe('')
    expect(separatorBetween(textJ('Total is '), claimJ())).toBe('')
    expect(separatorBetween(compareJ(), textJ('. More'))).toBe('')
    expect(separatorBetween(textJ('a\n'), compareJ())).toBe('')
  })
  it('puts a sentence break between two compares that touch', () => {
    expect(separatorBetween(compareJ(), compareJ())).toBe('. ')
  })
  it('puts a space or a break before a compare that follows text or a figure with nothing between', () => {
    expect(separatorBetween(textJ('It grew.'), compareJ())).toBe(' ')
    expect(separatorBetween(textJ('It grew'), compareJ())).toBe('. ')
    expect(separatorBetween(claimJ(), compareJ())).toBe('. ')
  })
  it('rev 8.3: a compare is closed with a full stop when the model\'s next text starts with a space, or is only a space', () => {
    expect(separatorBetween(compareJ(), textJ(' More text'))).toBe('.')
    expect(separatorBetween(compareJ(), textJ(' '))).toBe('.')
    expect(separatorBetween(compareJ(), textJ('\nMore'))).toBe('.')
    expect(separatorBetween(compareJ(), textJ(''))).toBe('. ')
    for (const closed of ['. More', ', and more', '; more', ') more', '!']) expect(separatorBetween(compareJ(), textJ(closed)), closed).toBe('')
  })
  it('puts a break after a compare that runs into the next text or figure', () => {
    expect(separatorBetween(compareJ(), textJ('Then it dipped.'))).toBe('. ')
    expect(separatorBetween(compareJ(), claimJ())).toBe('. ')
  })
  it('leaves text next to a figure alone: the model chose that spacing', () => {
    expect(separatorBetween(textJ('Total'), claimJ())).toBe('')
    expect(separatorBetween(claimJ(), textJ('x'))).toBe('')
  })
  it('never writes a digit', () => {
    for (const a of [textJ('x'), claimJ(), compareJ()]) for (const b of [textJ('y'), claimJ(), compareJ()]) expect(separatorBetween(a, b)).not.toMatch(/\d/)
  })
})

describe('rev 8.3: no comparison clause runs into what follows, in the 36 captured paragraphs', () => {
  const shownText = (judged: Judged[]): string =>
    judged.map((j, i) => (i > 0 ? separatorBetween(judged[i - 1]!, j) : '') + (j.seg.t === 'text' ? j.seg.s : j.seg.t === 'compare' ? '<CMP>' : '<CLAIM> label')).join('')
  const rendered = (captured as Array<{ names: string[]; target: string; paragraph: Segment[] }>).map((c) => ({
    ...c,
    text: shownText(parseParagraph({ paragraph: c.paragraph }, c.names, c.target)!.map((seg): Judged => ({ seg, verdict: 'neutral', rendered: '' }))),
  }))
  it('every compare is followed by a stop, a comma or the end, and preceded by the start or a stop', () => {
    expect(rendered.filter((r) => r.text.includes('<CMP>')).length).toBeGreaterThan(20)
    for (const { target, text } of rendered) {
      for (const m of text.matchAll(/<CMP>/g)) {
        const after = text.slice(m.index + 5)
        expect(after === '' || /^[.,;:!?)]/.test(after), `${target}: ${text}`).toBe(true)
        const before = text.slice(0, m.index).trimEnd()
        expect(before === '' || /[.!?:;]$/.test(before), `${target}: ${text}`).toBe(true)
      }
    }
  })
})

describe('rev 8.3: a paragraph that ends on a compare clause is closed with a full stop', () => {
  it('only a compare needs it; text and a claim end as the model left them', () => {
    expect(closingStop(compareJ())).toBe('.')
    expect(closingStop(textJ('Done.'))).toBe('')
    expect(closingStop(claimJ())).toBe('')
    expect(closingStop(undefined)).toBe('')
  })
})

describe('rev 8.3: a window_days mark is labelled in words', () => {
  it('names the period and holds no digit', () => {
    const seg = claim('window_days', '30', { span: 'last30' })
    expect(labelFor(seg, ctx)).toBe('vite · days in the past month')
    expect(labelFor(claim('window_days', '30', { span: 'window' }), ctx)).toMatch(/^vite · days in the past (month|year|three months)$/)
  })
})
