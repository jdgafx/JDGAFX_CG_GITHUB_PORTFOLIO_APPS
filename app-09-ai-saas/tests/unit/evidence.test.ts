import { describe, expect, it } from 'vitest'
import type { PackageFigures, SpikeEvidence, Summary } from '../../netlify/shared/contract'
import { buildPrompt, checkFigures, describeFigureCheck, parseInsightRequest } from '../../netlify/shared/insights'

const REACT: PackageFigures = { name: 'react', total: 912_345_678, avgPerDay: 32_583_774, changePct: 3.2, weekendPct: 54.1, sharePct: 62.5 }
const VUE: PackageFigures = { name: 'vue', total: 410_000_000, avgPerDay: 14_642_857, changePct: -4.1, weekendPct: 71.3, sharePct: 28.1 }
const SVELTE: PackageFigures = { name: 'svelte', total: 138_000_000, avgPerDay: 4_928_571, changePct: 12.8, weekendPct: 60.2, sharePct: 9.4 }

const REACT_SPIKE: SpikeEvidence = {
  name: 'react',
  date: '2026-09-28',
  downloads: 52_000_000,
  baseline: 36_000_000,
  sizePct: 44,
  releases: [
    { version: '19.2.1', date: '2026-09-27', kind: 'patch' },
    { version: '19.2.0', date: '2026-09-25', kind: 'minor' },
  ],
  moreReleases: 0,
  releasesKnown: true,
}
const VUE_SPIKE: SpikeEvidence = { name: 'vue', date: '2026-09-15', downloads: 21_000_000, baseline: 15_000_000, sizePct: 40, releases: [], moreReleases: 0, releasesKnown: true }

const BASE: Summary = { startDate: '2026-09-08', endDate: '2026-10-07', windowDays: 30, observedDays: 28, packages: [REACT, VUE, SVELTE] }
const WITH_SPIKES: Summary = { ...BASE, spikes: [VUE_SPIKE, REACT_SPIKE] }

describe('buildPrompt with spike evidence', () => {
  it('lists each spike with its size, usual level and the releases just before it', () => {
    const prompt = buildPrompt(WITH_SPIKES)
    expect(prompt).toContain(
      '- react on 2026-09-28: 52,000,000 downloads, +44% against the usual 36,000,000 for that weekday; stable releases in the 3 days up to that day: 19.2.1 (patch, 2026-09-27), 19.2.0 (minor, 2026-09-25)',
    )
    expect(prompt).toContain('- vue on 2026-09-15: 21,000,000 downloads, +40% against the usual 15,000,000 for that weekday; no stable release in the 3 days before')
    expect(prompt).toContain('starts with "Spikes:"')
    expect(prompt).toContain('a coincidence in time')
  })

  it('says the history is unavailable instead of claiming there were no releases', () => {
    const prompt = buildPrompt({ ...BASE, spikes: [{ ...VUE_SPIKE, releasesKnown: false }] })
    expect(prompt).toContain('; release history unavailable')
    expect(prompt).not.toContain('no stable release')
  })

  it('asks for one sentence when nothing was unusual, and adds nothing without evidence', () => {
    expect(buildPrompt({ ...BASE, spikes: [] })).toContain('Unusual days: none.')
    expect(buildPrompt(BASE)).not.toContain('Unusual days')
  })
})

describe('checkFigures with spike evidence', () => {
  const GOOD =
    'React hit 52,000,000 downloads on September 28, up 44% from the usual 36,000,000, a day after 19.2.1 came out on 2026-09-27.'

  it('matches the counts, the percentage, the dates and the version the evidence holds', () => {
    const check = checkFigures(GOOD, WITH_SPIKES)
    expect(check).toMatchObject({ checked: 6, matched: 6, unmatched: [] })
    expect(describeFigureCheck(check)).toBe('6 of 6 figures match the summary and spike evidence')
  })

  it('flags a date, a version and a percentage that are not in the evidence', () => {
    const check = checkFigures('React rose 45% on September 29 after 19.3.0, and again on Sep 28, 2025.', WITH_SPIKES)
    expect(check.checked).toBe(4)
    expect(check.matched).toBe(0)
    expect([...check.unmatched].sort()).toEqual(['19.3.0', '45%', 'September 29', 'Sep 28, 2025'].sort())
    expect(describeFigureCheck(check)).toContain('Not in the summary: ')
  })

  it('reads a worded date with or without a year, an ordinal and a month abbreviation', () => {
    expect(checkFigures('On Sep 15 and on September 28th and on 2026-09-08.', WITH_SPIKES)).toMatchObject({ checked: 3, matched: 3 })
    expect(checkFigures('On September 28, 2026 only.', WITH_SPIKES)).toMatchObject({ checked: 1, matched: 1 })
  })

  it('accepts the window dates from the summary', () => {
    expect(checkFigures('From 2026-09-08 to 2026-10-07.', WITH_SPIKES)).toMatchObject({ checked: 2, matched: 2 })
  })

  it('checks the direction of a spike percentage', () => {
    const check = checkFigures('React fell 44% on that day.', WITH_SPIKES)
    expect(check.unmatched).toEqual(['44% (direction does not match)'])
  })

  it('reads full versions only, and not a version in a longer dotted number', () => {
    expect(checkFigures('React 19 and v19.2 shipped.', WITH_SPIKES).checked).toBe(0)
    expect(checkFigures('Version v19.2.1 shipped.', WITH_SPIKES)).toMatchObject({ checked: 1, matched: 1 })
    expect(checkFigures('Build 1.2.3.4 shipped.', WITH_SPIKES).checked).toBe(0)
  })

  it('does not check dates or versions when the request carried no evidence', () => {
    expect(checkFigures('September 29 and 19.3.0 and 2026-01-01.', BASE).checked).toBe(0)
  })

  it('says which kinds of figure it looked for when there are none', () => {
    expect(describeFigureCheck(checkFigures('Nothing numeric.', WITH_SPIKES))).toBe(
      'No percentage, download-count, date or version figures in the answer to check',
    )
    expect(describeFigureCheck(checkFigures('Nothing numeric.', BASE))).toBe('No percentage or download-count figures in the answer to check')
  })
})

describe('checkFigures: a multiple must match the packages named in its sentence', () => {
  // react / vue is 2.2 times by total and by day. react / svelte is 6.6 and vue / svelte is 3.0.
  it('accepts a multiple between the two packages the sentence names', () => {
    expect(checkFigures("React is 2.2 times vue's size.", BASE)).toMatchObject({ checked: 1, matched: 1 })
    expect(checkFigures('Svelte trails react by 6.6 times.', BASE)).toMatchObject({ checked: 1, matched: 1 })
  })

  it('rejects a real multiple that belongs to a different pair than the one named', () => {
    const check = checkFigures('React is 6.6 times vue.', BASE)
    expect(check).toMatchObject({ checked: 1, matched: 0, unmatched: ['6.6 times'] })
    expect(checkFigures('Vue is 6.6 times svelte.', BASE).matched).toBe(0)
  })

  it('reads only the sentence the multiple is in', () => {
    expect(checkFigures('Vue is small. React is 6.6 times svelte.', BASE).matched).toBe(1)
    expect(checkFigures('Svelte is small. React is 6.6 times vue.', BASE).matched).toBe(0)
  })

  it('with one package named, accepts a multiple that involves it; with none, any real multiple', () => {
    expect(checkFigures('React is 6.6 times larger.', BASE).matched).toBe(1)
    expect(checkFigures('Vue is 6.6 times larger.', BASE).matched).toBe(0)
    expect(checkFigures('One is 3.0 times the other.', BASE).matched).toBe(1)
  })

  it('does not take react-dom for react', () => {
    // Only vue is named, and 6.6 is not a multiple that involves vue.
    expect(checkFigures('react-dom is 6.6 times vue.', BASE).matched).toBe(0)
  })
})

describe('parseInsightRequest with spikes', () => {
  const body = (spikes: unknown) => ({ summary: { ...BASE, spikes } })

  it('accepts the evidence and keeps it as sent', () => {
    const parsed = parseInsightRequest(body([REACT_SPIKE, VUE_SPIKE]))
    expect(parsed).toMatchObject({ ok: true })
    expect(parsed.ok && parsed.summary.spikes).toEqual([REACT_SPIKE, VUE_SPIKE])
  })

  it('accepts a request with no spikes field, and an empty list', () => {
    expect(parseInsightRequest({ summary: BASE })).toMatchObject({ ok: true })
    const empty = parseInsightRequest(body([]))
    expect(empty.ok && empty.summary.spikes).toEqual([])
  })

  it.each([
    ['a spike for a package that is not in the summary', { ...REACT_SPIKE, name: 'angular' }, 'summary.spikes[0].name'],
    ['a date outside the window', { ...REACT_SPIKE, date: '2026-10-08' }, 'summary.spikes[0].date'],
    ['a release dated after the spike', { ...REACT_SPIKE, releases: [{ version: '19.3.0', date: '2026-09-29', kind: 'minor' }] }, 'releases[0].date'],
    ['a release more than three days before', { ...REACT_SPIKE, releases: [{ version: '19.3.0', date: '2026-09-24', kind: 'minor' }] }, 'releases[0].date'],
    ['a version that is not x.y.z', { ...REACT_SPIKE, releases: [{ version: '19.2', date: '2026-09-27', kind: 'minor' }] }, 'releases[0].version'],
    ['a release kind that does not exist', { ...REACT_SPIKE, releases: [{ version: '19.2.1', date: '2026-09-27', kind: 'huge' }] }, 'releases[0].kind'],
    ['more than five releases', { ...REACT_SPIKE, releases: Array.from({ length: 6 }, () => ({ version: '19.2.1', date: '2026-09-27', kind: 'patch' })) }, 'spikes[0].releases'],
    ['a download count that is not a whole number', { ...REACT_SPIKE, downloads: 1.5 }, 'spikes[0].downloads'],
    ['a missing releasesKnown', { ...REACT_SPIKE, releasesKnown: undefined }, 'releasesKnown'],
  ])('rejects %s', (_label, spike, field) => {
    const parsed = parseInsightRequest(body([spike]))
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.error).toContain(field)
  })

  it('rejects a list longer than five packages times eight spikes, and a list that is not an array', () => {
    expect(parseInsightRequest(body(Array.from({ length: 41 }, () => REACT_SPIKE))).ok).toBe(false)
    expect(parseInsightRequest(body({})).ok).toBe(false)
  })
})

describe('checkFigures: a sentence that starts with a pronoun is about the previous sentence\'s package', () => {
  // The live case: zod 7.854 billion, react 5.7 billion, @anthropic-ai/sdk 834.9 million. zod / react = 1.378, zod / sdk = 9.407.
  const zodSummary: Summary = {
    startDate: '2025-10-08',
    endDate: '2026-10-07',
    windowDays: 365,
    observedDays: 358,
    packages: [
      { name: 'zod', total: 7_854_000_000, avgPerDay: 21_937_500, changePct: 189.9, weekendPct: 53.9, sharePct: 40.1 },
      { name: 'react', total: 5_700_000_000, avgPerDay: 15_921_788, changePct: 122.5, weekendPct: 55.8, sharePct: 29.1 },
      { name: '@anthropic-ai/sdk', total: 834_900_000, avgPerDay: 2_332_000, changePct: 459.8, weekendPct: 60.6, sharePct: 4.3 },
    ],
  }
  const LEAD = 'Zod leads with 7.85 billion downloads. '

  it.each([
    ['the live sentence', `${LEAD}It is roughly 1.4 times react's total and about 9 times @anthropic-ai/sdk's.`, 2, 2],
    ['Its as the opening word', `${LEAD}Its total is 1.4 times react's.`, 1, 1],
    ['The package', `${LEAD}The package is 9 times @anthropic-ai/sdk's size.`, 1, 1],
    ['a list number before the pronoun', `1. Zod leads with 7.85 billion downloads.\n2. It is about 1.4 times react's total.`, 1, 1],
    ['a pronoun reaching back past a sentence with no package', `${LEAD}That is a big lead. It is 1.4 times react's total.`, 1, 1],
  ])('accepts a right multiple: %s', (_label, text, checked, matched) => {
    const check = checkFigures(text, zodSummary)
    expect({ checked: check.checked - 1, matched: check.matched - 1 }).toEqual({ checked, matched }) // 7.85 billion is the lead's own figure
  })

  it.each([
    ['1.5 is not zod over react', `${LEAD}It is roughly 1.5 times react's total.`, '1.5 times'],
    ['9 is zod over sdk, not zod over react', `${LEAD}It is about 9 times react's total.`, '9 times'],
    ['react over sdk is 6.8, not a multiple of the subject', `${LEAD}It is 6.8 times @anthropic-ai/sdk's.`, '6.8 times'],
    ['no pronoun, so the subject is not borrowed: both named packages are react and sdk', `${LEAD}React is 1.4 times @anthropic-ai/sdk's total.`, '1.4 times'],
  ])('still rejects a wrong multiple: %s', (_label, text, rejected) => {
    expect(checkFigures(text, zodSummary).unmatched).toEqual([rejected])
  })

  it('does not borrow a package from more than three sentences back', () => {
    // With zod borrowed the pair would have to be zod and sdk (9.4), so 6.8 (react / sdk) would be rejected.
    // Out of reach, only sdk is named and 6.8 is a multiple that involves it.
    expect(checkFigures(`${LEAD}A. B. C. It is 6.8 times @anthropic-ai/sdk's.`, zodSummary).unmatched).toEqual([])
    expect(checkFigures(`${LEAD}A. B. It is 6.8 times @anthropic-ai/sdk's.`, zodSummary).unmatched).toEqual(['6.8 times'])
  })
})
