import { describe, expect, it } from 'vitest'
import { checkClaims } from '../../netlify/shared/claimCheck'
import type { Claim } from '../../netlify/shared/claims'
import type { Summary } from '../../netlify/shared/contract'
import fixtures from '../fixtures/live-summaries.json'

/** Repros from the third live verification (app-09h): spike counts, the metric label, pronoun multiples, "respectively", hedges. */
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

describe('spike counts: one checkable shape, everything else unchecked', () => {
  const N = F.N1h
  const X = F.X1h
  it.each([
    // D14: the partial word is outside the claim's quote
    ['D14 remaining outside the quote', 'The remaining unusual days are 9 in total, across the three packages.', N, claim('9 in total', 'spike_count', [])],
    ['D14b among the rest, with p empty', 'Express on 2026-09-20 reached 3,100,000 downloads. Among the rest, 9 spikes followed a release.', X, claim('9 spikes followed a release', 'spike_count', [])],
    ['D14b, a count true for the listed days', 'Among the rest, 3 spikes followed a release.', X, claim('3 spikes followed a release', 'spike_count', [])],
    // D15: the qualifier belongs to N, not to M
    ['S12 only 1 of the 3', 'Only 1 of the 3 unusual days had no release.', C1, claim('Only 1 of the 3 unusual days had no release', 'spike_count', [])],
    ['S18 one of the three', 'One of the three unusual days had no release.', C1, claim('One of the three unusual days had no release', 'spike_count', [])],
    ['H24 only 2 of Astro\'s 3', "Only 2 of Astro's 3 unusual days had a release.", N, undefined],
    // D16: counts of packages, the M in "N of the M", "between them", "of them for X"
    ['all three packages', 'All three packages had unusual days.', C1, undefined],
    ['all four packages, at least one', 'All four packages had at least one unusual day.', C1, undefined],
    ['of the three packages, only two', 'Of the three packages, only two had unusual days.', C1, undefined],
    ['each of the 4 packages', 'Each of the 4 packages had unusual days.', C1, undefined],
    ['two of the three', 'Vue had two of the three unusual days.', C1, undefined],
    ['5 of the 12', 'Next.js accounts for 5 of the 12 unusual days.', N, undefined],
    ['2 of the 3 spikes', 'Vue had 2 of the 3 spikes.', C1, undefined],
    ['three days stand out, two of them for Vue', 'Three days stand out, two of them for Vue.', C1, undefined],
    ['between them', 'Vue and Svelte had 3 unusual days between them.', C1, undefined],
    ['a pronoun-only clause', 'Vue is steady. It had 2 unusual days.', C1, undefined],
  ] as [string, string, Summary, Claim | undefined][])('%s is unchecked, never rejected', (_label, text, summary, c) => {
    expect(outcome(text, summary, c ? [c] : [])).toBe('unchecked')
  })

  it.each([
    ['the one package its clause names', 'Vue had 2 unusual days.', 'matched'],
    ['a wrong count for it', 'Vue had 3 unusual days.', 'rejected'],
    ['the total, said so', 'There were 3 unusual days in total.', 'matched'],
    ['a wrong total', 'There were 4 unusual days in total.', 'rejected'],
    ['with a release, right after the count', 'Vue had 2 unusual days with a release.', 'matched'],
    ['with no release, wrong', 'Vue had 1 unusual day with no release.', 'rejected'],
    ['spikes as the noun', 'Svelte had one spike.', 'matched'],
    ['a window length is not a count', 'In the last 30 days, Vue had 2 unusual days.', 'matched'],
  ] as [string, string, Outcome][])('%s', (_label, text, expected) => {
    expect(outcome(text, C1)).toBe(expected)
    expect(outcome(text, C1, [claim(text.replace(/\.$/, ''), 'spike_count', [])])).toBe(expected)
  })

  it('compares with the number found, and leaves the number listed unchecked (FA4)', () => {
    const capped: Summary = { ...C1, spikeCounts: { react: 0, vue: 2, svelte: 9 } }
    expect(outcome('Svelte had 9 unusual days.', capped)).toBe('matched')
    expect(outcome('Svelte had 1 unusual day.', capped)).toBe('unchecked') // the one listed
    expect(outcome('Svelte had 5 unusual days.', capped)).toBe('rejected')
    expect(outcome('Svelte had 1 unusual day with a release.', capped)).toBe('unchecked')
  })
})

describe('hedges of one significant figure (D17)', () => {
  const B2 = F.B2
  it('leaves a coarse hedge unchecked in a claim, instead of rejecting it', () => {
    const text = 'The gap is nearly 100,000 per day between openai and @anthropic-ai/sdk.'
    expect(outcome(text, B2, [claim('nearly 100,000 per day', 'difference', ['openai', '@anthropic-ai/sdk'], { m: 'per_day' })])).toBe('unchecked')
    expect(outcome('Svelte averages about 1,000,000 downloads per day.', C1, [claim('about 1,000,000 downloads per day', 'per_day', ['svelte'])])).toBe('unchecked')
    expect(outcome('Svelte averages about 2,000,000 downloads per day.', C1, [claim('about 2,000,000 downloads per day', 'per_day', ['svelte'])])).toBe('rejected')
  })
})

describe('the metric label (FA1)', () => {
  it.each([
    ['a label before a colon', 'Svelte\n- Per day: 26.5 million', 'unchecked'],
    ['the same figure under its own label', 'Svelte\n- Total: 26.5 million', 'matched'],
    ['a leading label with a comma', 'Svelte\n- Per day, 0.98 million', 'matched'],
    ['a leading label with a comma, wrong metric', 'Svelte\n- Total, 0.98 million', 'unchecked'],
  ] as [string, string, Outcome][])('%s', (_label, text, expected) => {
    expect(outcome(text, C1)).toBe(expected)
  })
})

describe('a multiple in a pronoun sentence (FA2) and a total with no package (FA3)', () => {
  it('uses the carried subject with the named packages, both of the pair', () => {
    expect(outcome('Svelte is small. It is 2.7 times vue\'s total.', C1)).toBe('matched') // vue / svelte
    expect(outcome('React is large. It is 2.7 times svelte\'s total.', C1)).toBe('unchecked') // react / svelte is 29.9
    expect(outcome('The package is 11 times larger.', C1)).toBe('unchecked') // nobody named, nothing carried
  })

  it('judges a total with no package against the package the sentence names, or leaves it unchecked', () => {
    expect(outcome('Svelte had 26.5 million downloads in total.', C1, [claim('26.5 million downloads in total', 'total', [])])).toBe('matched')
    expect(outcome('Svelte had 889.5 million downloads in total.', C1, [claim('889.5 million downloads in total', 'total', [])])).toBe('unchecked')
    expect(outcome('Together there were 889.5 million downloads.', C1, [claim('889.5 million downloads', 'total', [])])).toBe('matched')
  })
})

describe('"respectively" lists and the connective "Next," (FA5)', () => {
  it('leaves figures in a respectively list unchecked', () => {
    expect(outcome('Prisma and drizzle-orm run at about 59% and 61% of weekday levels respectively.', F.P1)).toBe('unchecked')
  })

  it('does not read a sentence-opening "Next," as the package', () => {
    expect(outcome('Next, nuxt holds 3.2% of the selection.', F.N1)).toBe('matched')
    expect(outcome('Next.js holds 88.7% of the selection.', F.N1)).toBe('matched')
  })
})
