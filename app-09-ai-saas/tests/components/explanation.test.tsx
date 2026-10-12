import { afterEach, describe, expect, it } from 'vitest'
import type { Judged } from '../../shared/claims'
import type { PackageFacts, Segment } from '../../shared/types'
import Explanation from '../../src/components/Explanation'
import FigureCheck from '../../src/components/FigureCheck'
import type { PkgOutcome } from '../../src/lib/useRun'
import { cleanup, mount } from '../ui/helpers'
import { stubFacts, stubWindow } from '../ui/stubCore'

afterEach(cleanup)

const claim = (kind: string, pkg: string, value: string, extra: Partial<Extract<Segment, { t: 'claim' }>> = {}): Segment =>
  ({ t: 'claim', kind, package: pkg, span: 'window', day: '', value, ...extra }) as Segment
const text = (s: string): Judged => ({ seg: { t: 'text', s }, verdict: 'neutral', rendered: s })

const WINDOW = stubWindow('2026-10-12', 30)
const NAMES = ['d3', 'vite']

/** One package's judged paragraph: a release-near unusual day, a last30 total, a wrong change_pct, a compare and a date. */
function judgedParagraph(): Judged[] {
  return [
    text('In the past month d3 had '),
    { seg: claim('window_total', 'd3', '800000', { span: 'last30' }), verdict: 'checked', rendered: '800,000' },
    text(' downloads, and its average per day moved '),
    { seg: claim('change_pct', 'd3', '+18.12'), verdict: 'wrong', rendered: '+18.1%', npmValue: '+27.2%' },
    text('. The day '),
    { seg: claim('unusual_day', 'd3', '2026-09-12', { day: '2026-09-12' }), verdict: 'checked', rendered: '12 Sep 2026' },
    text(' stood out. '),
    { seg: { t: 'compare', package: 'd3', peer: 'vite', metric: 'window_total', relation: 'higher' }, verdict: 'checked', rendered: "d3's total for the past month is higher than vite's" },
    text(' The model also wrote 246,877 here, and '),
    { seg: claim('day', 'd3', '2026-09-15', { day: '2026-09-15' }), verdict: 'neutral', rendered: '15 Sep 2026' },
    text('.'),
  ].map((j, i) => (i === 8 ? { ...j, verdict: 'unchecked' as const, runs: [{ start: 22, end: 29 }] } : j)) as Judged[]
}

const facts: PackageFacts[] = [
  {
    ...stubFacts('d3', 0),
    unusual: [{ day: '2026-09-12', value: 5000, median: 1000, kind: 'spike', release: 2, version: '7.1.6' }],
  },
  stubFacts('vite', 0),
]

const packages = (): Array<{ name: string; outcome: PkgOutcome }> => [
  { name: 'd3', outcome: { status: 'ok', judged: judgedParagraph() } },
  { name: 'vite', outcome: { status: 'withheld', reason: 'the paragraph was too long' } },
]

const renderRegion = (pkgs = packages()) =>
  mount(<Explanation names={NAMES} window={WINDOW} packages={pkgs} facts={facts} figures={[{ paragraph: 0, segment: 1 }, { paragraph: 0, segment: 3 }]} />).container

/** The region's text with claim marks and date marks removed, and the selected names' own digits taken out by position. */
function codeWrittenText(region: Element): string {
  const clone = region.cloneNode(true) as Element
  clone.querySelectorAll('.claim, time.date-mark').forEach(el => el.remove())
  let out = clone.textContent ?? ''
  for (const name of NAMES) out = out.split(name).join('')
  return out
}

describe('Explanation region (H1)', () => {
  it('has no digit that code wrote, including next to a wrong figure and a release', () => {
    const region = renderRegion().querySelector('section.explanation')!
    expect(region).not.toBeNull()
    expect(codeWrittenText(region)).not.toMatch(/\d/)
    // the wrong figure is really on screen
    expect(region.querySelector('.claim--wrong')?.textContent).toBe('+18.1%')
  })

  it('a wrong figure shows the model value, "(differs from npm)", and the npm value only in its title', () => {
    const region = renderRegion().querySelector('section.explanation')!
    const wrong = region.querySelector('mark.claim--wrong')!
    expect(wrong.textContent).toBe('+18.1%')
    expect(wrong.getAttribute('title')).toContain('+27.2%')
    expect(region.textContent).not.toContain('+27.2%')
    expect(wrong.parentElement?.textContent).toContain('(differs from npm)')
  })

  it('the version appears only in a title, and the label says the release in words', () => {
    const region = renderRegion().querySelector('section.explanation')!
    expect(region.textContent).not.toContain('7.1.6')
    const unusual = Array.from(region.querySelectorAll('mark.claim')).find(m => m.textContent === '12 Sep 2026')!
    expect(unusual.getAttribute('title')).toContain('7.1.6')
    expect(unusual.parentElement?.textContent).toContain('d3 · unusual day · release two days before')
  })

  it('labels carry the span in words and the change_pct label is the exact H2 text', () => {
    const text = renderRegion().querySelector('section.explanation')!.textContent!
    expect(text).toContain('d3 · total, past month')
    expect(text).toContain('d3 · change in average per day with downloads, past month vs the month before, days without downloads left out')
    expect(text).toContain('d3 · date in window')
  })

  it('a compare is one clause inside its mark, and the text around it is untouched', () => {
    const region = renderRegion().querySelector('section.explanation')!
    const clause = Array.from(region.querySelectorAll('mark.claim')).find(m => m.textContent?.includes('total for the past month'))!
    expect(clause.textContent).toBe("d3's total for the past month is higher than vite's")
    expect(region.textContent).toContain('The day ')
    expect(region.textContent).toContain(' stood out. ')
  })

  it('a day claim is neutral and never uses the success badge', () => {
    const region = renderRegion().querySelector('section.explanation')!
    const day = Array.from(region.querySelectorAll('mark.claim')).find(m => m.textContent === '15 Sep 2026')!
    expect(day.classList.contains('claim--neutral')).toBe(true)
    expect(region.querySelector('.ds-badge--success')).toBeNull()
  })

  it('wraps an undeclared digit run as unchecked and keeps the other bytes', () => {
    const region = renderRegion().querySelector('section.explanation')!
    const run = Array.from(region.querySelectorAll('mark.claim--unchecked')).find(m => m.textContent === '246,877')
    expect(run).toBeDefined()
    expect(region.textContent).toContain(' The model also wrote ')
    expect(region.textContent).toContain(' here, and ')
  })

  it('withheld is a partial state in words, with the reason; the headline is in words', () => {
    const region = renderRegion().querySelector('section.explanation')!
    const partial = region.querySelector('.ds-state--partial')!
    expect(partial.textContent).toContain("The explanation was withheld: the model's answer was not in the agreed format (the paragraph was too long).")
    expect(region.querySelector('h2')?.textContent).toBe('Downloads for d3 and vite over the past month')
    expect(region.querySelector('h2')?.getAttribute('tabindex')).toBe('-1')
    expect(region.querySelector('h2')?.hasAttribute('data-result-focus')).toBe(true)
    expect(region.querySelector('time.date-mark')?.textContent).toBe('11 Oct 2026')
  })

  it('shows the error state per package, or once when every call failed', () => {
    const some = renderRegion([
      { name: 'd3', outcome: { status: 'error' } },
      { name: 'vite', outcome: { status: 'ok', judged: [text('Fine.')] } },
    ])
    expect(some.querySelectorAll('.ds-state--error')).toHaveLength(1)
    expect(some.textContent).toContain('The explanation model did not answer in time or is unavailable.')
    expect(some.textContent).toContain('Fine.')
    const all = renderRegion([
      { name: 'd3', outcome: { status: 'error' } },
      { name: 'vite', outcome: { status: 'error' } },
    ])
    expect(all.querySelectorAll('.ds-state--error')).toHaveLength(1)
  })
})

describe('Explanation: model clauses that run together', () => {
  const compare = (peer: string): Judged => ({
    seg: { t: 'compare', package: 'd3', peer, metric: 'window_total', relation: 'higher' },
    verdict: 'checked',
    rendered: `d3's total for the past month is higher than ${peer}'s`,
  })
  it('puts a sentence break between touching compare clauses and around text that touches one', () => {
    const region = renderRegion([{ name: 'd3', outcome: { status: 'ok', judged: [text('d3 grew'), compare('vite'), compare('zod'), text('Then it dipped.')] } }]).querySelector('p.explanation__text')!
    expect(region.textContent).toBe("d3 grew. d3's total for the past month is higher than vite's. d3's total for the past month is higher than zod's. Then it dipped.")
  })
  it('rev 8.3: closes a paragraph that ends on a compare clause, and leaves one that ends on text alone', () => {
    const ends = renderRegion([{ name: 'd3', outcome: { status: 'ok', judged: [text('d3 grew. '), compare('vite')] } }]).querySelector('p.explanation__text')!
    expect(ends.textContent).toBe("d3 grew. d3's total for the past month is higher than vite's.")
    const text_ = renderRegion([{ name: 'd3', outcome: { status: 'ok', judged: [text('d3 grew. '), compare('vite'), text('. Then it dipped.')] } }]).querySelector('p.explanation__text')!
    expect(text_.textContent).toBe("d3 grew. d3's total for the past month is higher than vite's. Then it dipped.")
  })
  it('adds nothing before a compare that follows a finished sentence, closes it with a stop before a space-led text (rev 8.3), and leaves the text segments byte for byte', () => {
    const region = renderRegion([{ name: 'd3', outcome: { status: 'ok', judged: [text('d3 grew. '), compare('vite'), text(' Then it dipped.')] } }]).querySelector('p.explanation__text')!
    expect(region.textContent).toBe("d3 grew. d3's total for the past month is higher than vite's. Then it dipped.")
  })
})

describe('Explanation: a compare code could not fill, and a growth it could not compute (R2)', () => {
  it('a wrong compare with no relation reads "(no comparison) (differs from npm)", a not-computable change "(no value) (differs from npm)"', () => {
    const unset: Judged = { seg: { t: 'compare', package: 'd3', peer: 'd3', metric: 'window_total' }, verdict: 'wrong', rendered: '(no comparison)', reason: 'same package' }
    const empty: Judged = { seg: claim('change_pct', 'd3', ''), verdict: 'wrong', rendered: '(no value)', reason: 'no basis' }
    const region = renderRegion([{ name: 'd3', outcome: { status: 'ok', judged: [text('x '), unset, text(' y '), empty] } }])
    const marks = Array.from(region.querySelectorAll('mark.claim--wrong'))
    expect(marks.map(m => m.textContent)).toEqual(['(no comparison)', '(no value)'])
    expect(region.querySelectorAll('.claim-note')).toHaveLength(2)
    expect(region.querySelector('p.explanation__text')!.textContent).toContain('(no comparison)')
    expect(region.querySelector('p.explanation__text')!.textContent).toContain('(differs from npm)')
  })
})

describe('Explanation: a refusal from the function', () => {
  it('shows the words of the refusal in place of the generic notice, per package and when every call failed', () => {
    const msg = 'Too many requests. Please wait a minute and try again.'
    const some = renderRegion([
      { name: 'd3', outcome: { status: 'error', message: msg } },
      { name: 'vite', outcome: { status: 'ok', judged: [text('Fine.')] } },
    ])
    expect(some.textContent).toContain(msg)
    expect(some.textContent).not.toContain('did not answer in time')
    const all = renderRegion([
      { name: 'd3', outcome: { status: 'error', message: msg } },
      { name: 'vite', outcome: { status: 'error' } },
    ])
    expect(all.querySelectorAll('.ds-state--error')).toHaveLength(1)
    expect(all.textContent).toContain(msg)
  })
})

describe('FigureCheck', () => {
  const figures = [{ paragraph: 0, segment: 1 }, { paragraph: 0, segment: 3 }]
  const rowsByName = { d3: { '2026-09-20': 0, '2026-09-21': 10 }, vite: {} }
  const render = () =>
    mount(<FigureCheck window={WINDOW} packages={packages()} facts={facts} figures={figures} rowsByName={rowsByName} />).container

  it('lives outside the explanation region and carries the summary and the shown count', () => {
    const container = render()
    expect(container.querySelector('section.explanation')).toBeNull()
    const section = container.querySelector('section.figure-check')!
    expect(section.textContent).toContain('3 checked, 1 wrong, 1 unchecked, 1 date, 1 comparison')
    expect(section.textContent).toContain('1 of 2 package explanations shown')
  })

  it('lists every claim with its model value, npm value, how to check and verdict', () => {
    const rows = Array.from(render().querySelectorAll('section.figure-check tbody tr'))
    expect(rows).toHaveLength(6)
    const wrong = rows.find(r => r.textContent?.includes('change_pct'))!
    const cells = Array.from(wrong.querySelectorAll('td')).map(td => td.textContent)
    expect(cells[0]).toBe('2')
    expect(cells[1]).toBe('+18.1%')
    expect(cells).toContain('+27.2%')
    expect(cells.some(c => c?.includes('800,000/30'))).toBe(true)
    expect(cells.some(c => c?.includes('2026-09-20'))).toBe(true)
    expect(wrong.textContent).toContain('wrong')
  })

  it('numbers the first claims that carry a figure and leaves dates and comparisons unnumbered', () => {
    const rows = Array.from(render().querySelectorAll('section.figure-check tbody tr'))
    const numbers = rows.map(r => r.querySelector('td')?.textContent)
    expect(numbers).toEqual(['1', '2', '', '', '', ''])
  })

  it('a date row is neutral and does not use the success badge', () => {
    const rows = Array.from(render().querySelectorAll('section.figure-check tbody tr'))
    const date = rows.find(r => r.textContent?.includes('15 Sep 2026'))!
    expect(date.querySelector('.ds-badge--success')).toBeNull()
  })
})
