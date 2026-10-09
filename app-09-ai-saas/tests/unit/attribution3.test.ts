import { describe, expect, it } from 'vitest'
import { checkClaims } from '../../netlify/shared/claimCheck'
import type { Claim } from '../../netlify/shared/claims'
import type { Summary } from '../../netlify/shared/contract'
import { sentenceAt, sentenceSpans, clauseSpans } from '../../netlify/shared/boundaries'
import { figureOccurrences } from '../../netlify/shared/figures'
import fixtures from '../fixtures/live-summaries.json'

/** Repros from the fourth live verification (app-09i): one boundary rule, ranges, counts after colons, metric words in the clause. */
const F = fixtures as unknown as Record<string, Summary>
const C1 = { ...F.C1, spikeCounts: { react: 0, vue: 2, svelte: 1 } }
const claim = (q: string, k: Claim['k'], p: string[], extra: Partial<Claim> = {}): Claim => ({ q, k, p, ...extra })
type Outcome = 'matched' | 'unchecked' | 'rejected'
function outcome(text: string, summary: Summary, claims: Claim[] = []): Outcome {
  const c = checkClaims(text, claims, summary)
  if (c.rejected.length > 0) return 'rejected'
  if (c.unchecked.length > 0 || c.matched === 0) return 'unchecked'
  return 'matched'
}
const counts = (text: string, summary: Summary, claims: Claim[] = []) => {
  const c = checkClaims(text, claims, summary)
  return { matched: c.matched, unchecked: c.unchecked.length, rejected: c.rejected.length }
}

describe('one boundary rule', () => {
  const texts = (text: string) => sentenceSpans(text).map((s) => text.slice(s.start, s.end))
  it('does not end a sentence at a decimal point, a dotted name or an abbreviation', () => {
    expect(texts('Vue and Svelte grew 20.5% and 12.4% respectively.')).toEqual(['Vue and Svelte grew 20.5% and 12.4% respectively', ''])
    expect(texts('Next.js had 5 unusual days. Nuxt had 4.')).toEqual(['Next.js had 5 unusual days', ' Nuxt had 4', ''])
    expect(texts('Several packages, e.g. Svelte, hold 3%. React holds 88.9%.')).toEqual(['Several packages, e.g. Svelte, hold 3%', ' React holds 88.9%', ''])
    expect(texts('React vs. Vue is close. Done.')).toEqual(['React vs. Vue is close', ' Done', ''])
  })

  it('ends a sentence at a line break, so list items are separate', () => {
    expect(texts('1. React\n- Share: 88.9%\n- Per day: 29.3 million')).toEqual(['1', ' React', '- Share: 88.9%', '- Per day: 29.3 million'])
  })

  it('ends a clause at a colon, a semicolon and a dash too', () => {
    const t = 'Svelte: 3% share; React — 88.9%.'
    expect(clauseSpans(t).map((s) => t.slice(s.start, s.end))).toEqual(['Svelte', ' 3% share', ' React ', ' 88.9%', ''])
    expect(sentenceAt(t, 12)).toEqual(sentenceSpans(t)[0])
  })

  it('finds the "respectively" in a sentence with decimals and dotted names (D18)', () => {
    expect(counts('Vue and Svelte grew 20.5% and 12.4% respectively.', C1)).toMatchObject({ matched: 0, rejected: 0, unchecked: 2 })
    expect(counts('React and Vue hold 8.1% and 88.9% of downloads respectively.', C1)).toMatchObject({ matched: 0, rejected: 0 })
    expect(counts('Svelte and Vue sit at 46.1% and 50.1% of weekday levels on weekends, respectively.', C1)).toMatchObject({ matched: 0, rejected: 0 })
    expect(counts('React and Vue are 2.7 and 29.8 times Svelte respectively.', C1)).toMatchObject({ matched: 0, rejected: 0 })
    expect(counts('Next.js and Astro grew 48.0% and 26.0% respectively.', F.N1)).toMatchObject({ matched: 0, rejected: 0 })
    expect(counts('Vue and Svelte grew 20% and 12% respectively.', C1)).toMatchObject({ matched: 0, unchecked: 2 }) // the control
  })

  it('keeps a partial-count word in view when the sentence has a dotted name or a decimal (D21)', () => {
    const N1 = F.N1
    for (const text of [
      'Among the others, Next.js had 2 unusual days.',
      'Of the remaining days, Next.js had 2 unusual days.',
      'Besides those, only Next.js had 2 unusual days with a release.',
      'Of the rest, Next.js had 5 unusual days.',
      'Among the others, Nuxt at 0.3 million a day had 3 unusual days.',
      'Among the others, Nuxt at about 300,000 a day had 3 unusual days.',
    ]) expect(outcome(text, N1), text).toBe('unchecked')
    expect(outcome('Next.js had 5 unusual days.', N1)).toBe('matched')
  })
})

describe('ranges (D19)', () => {
  const P1: Summary = { ...F.P1, packages: F.P1.packages.map((p) => (p.name === 'prisma' ? { ...p, weekendPct: 59.8 } : p.name === 'drizzle-orm' ? { ...p, weekendPct: 62.9 } : p)) }
  const both = 'Prisma and drizzle-orm run at about 60 to 63% of weekday levels.'
  it.each([
    ['N to M%', both, '60 to 63%'],
    ['N-M%', both.replace('60 to 63%', '60-63%'), '60-63%'],
    ['N–M%', both.replace('60 to 63%', '60–63%'), '60–63%'],
    ['between N% and M%', both.replace('about 60 to 63%', 'between 60% and 63%'), 'between 60% and 63%'],
  ])('holds for both packages: %s', (_label, text, quote) => {
    for (const p of [['prisma'], ['drizzle-orm'], ['prisma', 'drizzle-orm'], []]) {
      expect(counts(text, P1, [claim(quote, 'weekend_pct', p)]), `${quote} ${p}`).toMatchObject({ matched: 1, rejected: 0, unchecked: 0 })
    }
    expect(counts(text, P1)).toMatchObject({ matched: 1, rejected: 0, unchecked: 0 })
  })

  it('is unchecked, never rejected, when a named package falls outside it or nothing says which', () => {
    expect(counts('Prisma and drizzle-orm run at about 70 to 75% of weekday levels.', P1, [claim('70 to 75%', 'weekend_pct', ['prisma'])])).toMatchObject({ rejected: 0, unchecked: 1, matched: 0 })
    expect(counts('Typeorm and prisma run at about 60 to 63% of weekday levels.', P1, [claim('60 to 63%', 'weekend_pct', ['prisma'])])).toMatchObject({ rejected: 0, unchecked: 1 })
    expect(counts('Weekends run at about 60 to 63% of weekday levels.', P1)).toMatchObject({ rejected: 0, matched: 0, unchecked: 1 })
  })

  it('reads a range as one figure with its bounds', () => {
    const [range] = figureOccurrences('about 60 to 63% of weekday levels')
    expect(range.quoted.range).toEqual({ low: 60, high: 63, decimals: 0 })
    expect(range.whole).toBe('60 to 63%')
  })
})

describe('a count after a colon, when the sentence names the package (D22)', () => {
  it.each([
    ['Vue leads the spikes: 2 unusual days in total.', C1],
    ['Vue leads the spikes: 3 unusual days in total.', C1],
    ['Next.js leads the spike table: 12 unusual days in total.', F.N1],
  ] as [string, Summary][])('%s is unchecked', (text, summary) => {
    expect(outcome(text, summary)).toBe('unchecked')
  })
  it('still takes a total in a sentence that names nobody', () => {
    expect(outcome('There were 3 unusual days in total.', C1)).toBe('matched')
  })
})

describe('metric words in the clause, not only next to the figure (FA1 residual)', () => {
  it.each([
    ["Svelte's daily downloads, which climbed steadily, reached 26.5 million.", 'unchecked'],
    ['Svelte, average day: 26.5 million.', 'unchecked'],
    ['Svelte averaged 26.5 million.', 'unchecked'],
    ['Svelte averaged 0.98 million.', 'matched'],
    ["Svelte's daily downloads, which climbed steadily, reached 0.98 million.", 'matched'],
    ['Svelte reached 26.5 million in total.', 'matched'],
  ] as [string, Outcome][])('%s', (text, expected) => {
    expect(outcome(text, C1)).toBe(expected)
  })
})

describe('the owner of a figure after "with" or "unlike" (E2, E11)', () => {
  it.each([
    ['React leads Vue and Svelte with 3% of downloads.', 'unchecked'], // 3% is Svelte's, the sentence is about React
    ['React leads Vue and Svelte with 88.9% of downloads.', 'matched'],
    ['React, unlike Svelte, holds 3% of downloads.', 'unchecked'],
    ['Svelte, unlike React, holds 3% of downloads.', 'matched'],
  ] as [string, Outcome][])('%s', (text, expected) => {
    expect(outcome(text, C1)).toBe(expected)
  })
})

describe('two packages, each with its own figure, are not read as one subject and an object list (live regressions)', () => {
  it('matches "openai holding 50.5% ... and the SDK holding 49.5%"', () => {
    const text = "The two are nearly level, with openai holding 50.5% of the selection's downloads and @anthropic-ai/sdk holding 49.5%."
    expect(counts(text, F.B2)).toMatchObject({ matched: 2, rejected: 0, unchecked: 0 })
  })

  it('matches "React follows with 5.7 billion (29.1%) and Vite with 5.2 billion (26.4%)"', () => {
    expect(counts('React follows with 5.7 billion (29.1%) and Vite with 5.2 billion (26.4%).', F.A3)).toMatchObject({ matched: 4, rejected: 0, unchecked: 0 })
  })

  it('reads a range for the packages named before it, not for one named after "while"', () => {
    const P1i = F.P1i
    const text = 'Drizzle-orm and prisma run at about 60 to 63% of weekday volume on weekends, while typeorm drops much lower.'
    expect(counts(text, P1i)).toMatchObject({ matched: 1, rejected: 0, unchecked: 0 })
  })
})
