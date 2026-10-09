import { describe, expect, it } from 'vitest'
import { checkClaims } from '../../netlify/shared/claimCheck'
import type { Claim } from '../../netlify/shared/claims'
import type { Summary } from '../../netlify/shared/contract'
import { parseClaims } from '../../netlify/shared/claims'
import fixtures from '../fixtures/live-summaries.json'
import liveRuns from '../fixtures/live-runs.json'

/**
 * Every probe text from the live verifications (app-09f and app-09g, their tools and their defect reports), run on the
 * summaries of the live runs they were found on. Each has the outcome a visitor should see: a true sentence matches, a
 * wrong one is rejected, and one the text does not let the check judge is left unchecked.
 */
const F = fixtures as unknown as Record<string, Summary>
const C1 = { ...F.C1, spikeCounts: { react: 0, vue: 2, svelte: 1 } }
const claim = (q: string, k: Claim['k'], p: string[], extra: Partial<Claim> = {}): Claim => ({ q, k, p, ...extra })

type Outcome = 'matched' | 'unchecked' | 'rejected'
/** The one outcome of a text with one figure to judge. Rejected beats unchecked beats matched. */
function outcome(text: string, summary: Summary, claims: Claim[] = []): Outcome {
  const check = checkClaims(text, claims, summary)
  if (check.rejected.length > 0) return 'rejected'
  if (check.unchecked.length > 0 || check.matched === 0) return 'unchecked'
  return 'matched'
}
const counts = (text: string, summary: Summary, claims: Claim[] = []) => {
  const c = checkClaims(text, claims, summary)
  return { matched: c.matched, unchecked: c.unchecked.length, rejected: c.rejected.length }
}

const SAMPLE = (s: Summary, name: string) => s.spikes?.filter((spike) => spike.name === name) ?? []
const grouped = (n: number) => n.toLocaleString('en-US')

describe('a value belongs to the package the text says it is about (C1: react, vue, svelte)', () => {
  const cases: [string, string, Outcome][] = [
    // app-09f D4
    ['another package\'s daily average', 'Svelte averages 2.7 million downloads per day.', 'unchecked'],
    ["another package's share", "Svelte's share is 8.1%.", 'unchecked'],
    ["another package's weekend level", 'Svelte weekend days run at 59.2% of weekday levels.', 'unchecked'],
    ['another package\'s value through the hedge', 'Svelte averages about 30,000,000 downloads per day.', 'unchecked'],
    ['the right package', 'Vue averages 2.7 million downloads per day.', 'matched'],
    // app-09g D6: a pronoun carries the package before it
    ['Its share (Vue\'s)', 'Svelte is the smallest of the three. Its share is 8.1%.', 'unchecked'],
    ['It averages (Vue\'s)', 'Svelte is the smallest of the three. It averages 2.7 million downloads per day.', 'unchecked'],
    ['Its weekend (React\'s)', 'Svelte is the smallest of the three. Its weekend days run at 59.2% of weekday downloads.', 'unchecked'],
    ['The package holds (React\'s share)', 'Svelte is the smallest. The package holds 88.9% of downloads.', 'unchecked'],
    ['It, hedged (React\'s)', 'Svelte is the smallest. It averages about 30,000,000 downloads per day.', 'unchecked'],
    ['It, right value', 'Svelte is the smallest. It averages 1.0 million downloads per day.', 'matched'],
    ['It after two packages is ambiguous', 'React grew 13.3% while Vue grew 12.4%. It runs at 46.1% on weekends.', 'unchecked'],
    // app-09g D7: a colon, semicolon, list item or line break splits the name from its figures
    ['nameless sentence after a named one', 'Svelte is the smallest of the three. Weekend days run at 59.2% of weekday downloads.', 'unchecked'],
    ['nameless share after a named one', 'Svelte is the smallest of the three. Its share is 8.1%.', 'unchecked'],
    ['semicolon', 'Svelte is smallest; it holds 8.1% of downloads.', 'unchecked'],
    ['two nameless figures', 'Svelte is the smallest. Per day, 2.7 million; share, 8.1%.', 'unchecked'],
    // two packages named in one clause
    ['the nearer package owns the figure', 'Vue is well ahead of Svelte, which averages 2.7 million downloads per day.', 'unchecked'],
    ['a swapped percentage', 'React grew 12.4%, ahead of Vue.', 'unchecked'],
    ['a selection-wide total claimed for one package', 'Svelte has 889.5 million downloads in the window.', 'unchecked'],
    ['the selection total said for the selection', 'Together the three have 889.5 million downloads in the window.', 'matched'],
    // app-09g D8: a total is not a per-day figure, a spike day is not the usual level
    ['a total written as per day', 'Svelte averages 26.5 million downloads per day.', 'unchecked'],
    ['a per-day figure written as the total', 'Svelte had 1.0 million downloads in total.', 'unchecked'],
    ['the total, written right', 'Svelte had 26.5 million downloads in total.', 'matched'],
    ['a spike day called the usual level', `Vue's usual weekday level is ${grouped(SAMPLE(C1, 'vue')[0].downloads)}.`, 'unchecked'],
    ['the usual level, right', `Vue's usual weekday level is ${grouped(SAMPLE(C1, 'vue')[0].baseline)}.`, 'matched'],
    ['two packages, each with its own figure', 'Svelte grew 20.5%, while React grew 13.3%.', 'matched'],
    ['two packages, the second figure swapped', 'Svelte grew 20.5%, while React grew 12.4%.', 'unchecked'],
    ['another package\'s value, exact, in a per-day sentence', 'Vue gets 981,621 downloads per day.', 'unchecked'],
    ['"some" hedging one significant figure', 'On some days, 1,000,000 Svelte downloads arrived.', 'unchecked'],
    ['a spike day, right', `On 2026-09-19 Vue recorded ${grouped(SAMPLE(C1, 'vue')[0].downloads)} downloads.`, 'matched'],
  ]
  it.each(cases)('%s', (_label, text, expected) => {
    expect(outcome(text, C1)).toBe(expected)
  })

  it('reads a list item under its heading line', () => {
    expect(counts('3. Svelte\n- Share: 8.1%\n- Per day: 2.7 million', C1)).toMatchObject({ matched: 0, rejected: 0, unchecked: 2 })
    expect(counts('3. Svelte\n- Share: 3%\n- Per day: 0.98 million', C1)).toMatchObject({ matched: 2, rejected: 0, unchecked: 0 })
    expect(counts('Svelte: 8.1% share and 2.7 million per day.', C1)).toMatchObject({ matched: 0, unchecked: 2 })
    expect(counts('Svelte: 3% share and 0.98 million per day.', C1)).toMatchObject({ matched: 2, unchecked: 0 })
  })

  it('does not carry a package across a blank line', () => {
    expect(counts('Svelte is the smallest.\n\nIts share is 3%.', C1)).toMatchObject({ matched: 0, unchecked: 1 })
  })

  it('the same figure, claimed for the wrong package, is unchecked; claimed for the right one it matches', () => {
    const text = 'Vue is well ahead of Svelte, which averages 2.7 million downloads per day.'
    expect(outcome(text, C1, [claim('2.7 million downloads per day', 'per_day', ['vue'])])).toBe('unchecked') // the text says it is Svelte's
    expect(outcome(text, C1, [claim('2.7 million downloads per day', 'per_day', ['svelte'])])).toBe('rejected') // and then it is wrong
    expect(outcome('Svelte averages about 30,000,000 downloads per day.', C1, [claim('about 30,000,000 downloads per day', 'per_day', ['svelte'])])).toBe('rejected') // app-09g D5
  })
})

describe('hedge rounding needs two significant figures', () => {
  it.each([
    ['About 3,000,000 is one figure: 2,665,017 is not 3,000,000 at this precision', 'Vue gets about 3,000,000 downloads per day.', 'unchecked'],
    ['two figures: about 2,700,000 rounds from 2,665,017', 'Vue gets about 2,700,000 downloads per day.', 'matched'],
    ['an exact count', 'Vue gets 2,665,017 downloads per day.', 'matched'],
  ] as [string, string, Outcome][])('%s', (_label, text, expected) => {
    expect(outcome(text, C1)).toBe(expected)
  })
})

describe('aliases (app-09g D11)', () => {
  const M1 = F.M1
  const mcp = M1.packages[1]
  it('does not let a short name that two packages share name either of them', () => {
    // "The SDK" is the tail of both @anthropic-ai/sdk and @modelcontextprotocol/sdk: it names neither.
    expect(outcome(`The SDK holds ${mcp.sharePct}% of the selection.`, M1)).toBe('unchecked')
    expect(outcome(`The Anthropic SDK holds ${mcp.sharePct}% of the selection.`, M1)).toBe('unchecked') // that is the other package's share
    expect(outcome(`The Anthropic SDK holds ${M1.packages[0].sharePct}% of the selection.`, M1)).toBe('matched')
    // A long run-together name also names the package when written as spaced words.
    expect(outcome(`The Model Context Protocol SDK holds ${mcp.sharePct}% of the selection.`, M1)).toBe('matched')
    expect(outcome(`@modelcontextprotocol/sdk holds ${mcp.sharePct}% of the selection.`, M1)).toBe('matched')
  })

  const pkg = (name: string, sharePct: number, avgPerDay: number) => ({ name, total: avgPerDay * 365, avgPerDay, changePct: 1, weekendPct: 50, sharePct })
  const types: Summary = { ...C1, packages: [pkg('react', 50.5, 5_300_000), pkg('@types/react', 49.5, 5_200_000)], spikes: [], spikeCounts: undefined }
  it('does not name react by the tail of @types/react', () => {
    expect(outcome('React holds 49.5% of the selection.', types)).toBe('unchecked')
    expect(outcome('React holds 50.5% of the selection.', types)).toBe('matched')
    expect(outcome('@types/react holds 49.5% of the selection.', types)).toBe('matched')
  })

  const next: Summary = { ...C1, packages: [pkg('next', 50.5, 5_300_000), pkg('nuxt', 49.5, 5_200_000)], spikes: [], spikeCounts: undefined }
  it('does not read the English word "next" as the package', () => {
    expect(outcome('Over the next month nuxt is expected to hold 50.5%.', next)).toBe('unchecked')
    expect(outcome('Next.js holds 50.5% of the selection.', next)).toBe('matched')
    expect(outcome('Next holds 50.5% of the selection.', next)).toBe('matched')
  })
})

describe('multiples are judged against every pair the text names (app-09g, N1)', () => {
  const N1 = F.N1
  it('rejects a ratio no named pair gives, whatever the claim says', () => {
    // Next.js / Astro is 10.86 by total.
    const text = 'Astro is about 9.1 times smaller in total downloads than Next.js.'
    expect(outcome(text, N1)).toBe('unchecked') // no claim, so the sentence check
    expect(outcome(text, N1, [claim('9.1 times smaller in total downloads', 'multiple', ['astro', 'next'], { m: 'total' })])).toBe('rejected')
    expect(outcome('Astro is about 10.9 times smaller in total downloads than Next.js.', N1, [claim('10.9 times smaller in total downloads', 'multiple', ['astro', 'next'], { m: 'total' })])).toBe('matched')
  })

  it('leaves a ratio of another pair the text names unchecked, not rejected', () => {
    const text = 'Next.js is about 28 times Nuxt by total, and Astro is smaller.'
    expect(outcome(text, N1, [claim('28 times Nuxt', 'multiple', ['next', 'astro'])])).toBe('unchecked')
  })
})

describe('counts of unusual days (app-09g D9 to D13)', () => {
  const C = (extra: Partial<Summary> = {}): Summary => ({ ...C1, ...extra })
  const spike = (text: string, p: string[], summary: Summary = C1) => outcome(text, summary, [claim(text.replace(/\.$/, ''), 'spike_count', p)])

  it.each([
    ['"N of the M" is not a plain count', 'Of the 3 unusual days, 2 followed a release.', 'unchecked'],
    ['a window length before the count', 'In the last 30 days, Vue had 2 unusual days.', 'matched'],
    ['an ISO date before the count', `Since ${C1.startDate}, Vue had two unusual days.`, 'matched'],
    ['a year before the count', 'In 2026 Vue had two unusual days.', 'matched'],
    ['a number of days before the count', 'Over 365 days Vue had 2 unusual days.', 'matched'],
    ['a wrong count', 'Vue had 3 unusual days.', 'rejected'],
    ['the remaining count', 'The remaining 8 unusual days are not listed.', 'unchecked'],
    ['a count for the package the text names, not the total (D10)', 'Svelte had 3 unusual days.', 'rejected'],
    ['the right count for the package the text names', 'Svelte had one unusual day.', 'matched'],
  ] as [string, string, Outcome][])('%s', (_label, text, expected) => {
    expect(outcome(text, C1)).toBe(expected)
    expect(spike(text, [])).toBe(expected)
  })

  it('reads number words with or without a hyphen, and the true total', () => {
    const A3 = F.A3
    expect(outcome('There are twenty eight unusual days in total.', A3)).toBe('matched')
    expect(outcome('There are twenty-eight unusual days in total.', A3)).toBe('matched')
    expect(outcome('There are twenty unusual days in total.', A3)).toBe('rejected')
  })

  it('scans counts no claim covers (N1 live: Next.js 5, Nuxt 4, Astro 3)', () => {
    const N1 = F.N1
    expect(outcome('Next.js had 5 unusually high days.', N1)).toBe('matched')
    expect(outcome('Next.js had 3 unusually high days.', N1)).toBe('rejected')
    expect(outcome('Astro had 4 unusual days.', N1)).toBe('rejected')
    expect(outcome('Nuxt had 3 unusual days.', N1)).toBe('rejected')
    expect(counts('Next.js had 3 unusually high days. Astro had 3 unusual days.', N1)).toMatchObject({ matched: 1, rejected: 1 })
  })

  it('checks a count claimed with no package against the package the sentence names (Z1: the SDK has 7)', () => {
    const Z1 = F.Z1
    expect(spike('The SDK had 13 unusual days.', [], Z1)).toBe('rejected')
    expect(spike('The SDK had 7 unusual days.', [], Z1)).toBe('matched')
    expect(spike('In total there were 13 unusual days.', [], Z1)).toBe('matched')
  })

  it('judges against the number found, leaves the number listed unchecked when the list is capped, and leaves a qualified count unchecked', () => {
    const capped = C({ spikeCounts: { react: 0, vue: 2, svelte: 9 } }) // svelte had 9 found, 1 listed
    expect(outcome('There are 11 unusual days in total.', capped)).toBe('matched') // found: 0 + 2 + 9
    expect(outcome('There are 3 unusual days in total.', capped)).toBe('unchecked') // listed: 2 + 1, what the page lists, not what was found
    expect(outcome('There are 5 unusual days in total.', capped)).toBe('rejected')
    expect(outcome('Svelte had 9 unusual days.', capped)).toBe('matched')
    expect(outcome('Svelte had 2 unusual days with a release.', capped)).toBe('unchecked') // cannot be told from a capped list
  })
})

describe('sentences from the live runs stay matched', () => {
  const Z1 = F.Z1
  it.each([
    ['zod 7.8 billion total', 'Zod leads with 7.85 billion downloads in total.', 'matched'],
    ['the live It sentence', "Zod leads with 7.85 billion downloads. It is roughly 1.4 times react's total.", 'unchecked'], // react is not in Z1
  ] as [string, string, Outcome][])('%s', (_label, text, expected) => {
    expect(outcome(text, Z1)).toBe(expected)
  })

  it('A3: the SDK is 9.4 times smaller than zod, with the subject first', () => {
    const A3 = F.A3
    const text = 'The Anthropic SDK is much smaller, about 9.4 times fewer than Zod.'
    expect(outcome(text, A3, [claim('9.4 times fewer than Zod', 'multiple', ['@anthropic-ai/sdk', 'zod'])])).toBe('matched')
    expect(outcome('Zod leads with 7.85 billion downloads. It is about 9.4 times the SDK.', A3, [claim('9.4 times the SDK', 'multiple', ['zod', '@anthropic-ai/sdk'], { m: 'total' })])).toBe('matched')
  })

  it('C1: the two "30 times" figures, one wrong and one right', () => {
    const text = "React is roughly 30 times Vue's 72 million total and about 30 times Svelte's 26.5 million."
    const check = checkClaims(text, [claim("30 times Vue's 72 million", 'multiple', ['react', 'vue']), claim("30 times Svelte's", 'multiple', ['react', 'svelte'])], C1)
    expect(check.rejected).toHaveLength(1)
    expect(check.rejected[0].start).toBe(text.indexOf('30 times'))
    expect(check.matched).toBeGreaterThanOrEqual(1)
  })

  it('B2: the gap between two packages, written roughly', () => {
    const B2 = F.B2
    const text = 'openai averaged 5,386,613 downloads per day and @anthropic-ai/sdk averaged 5,287,553 per day. The gap is small, roughly 99,000 per day.'
    expect(counts(text, B2, [claim('roughly 99,000 per day', 'difference', ['openai', '@anthropic-ai/sdk'], { m: 'per_day' })])).toMatchObject({ rejected: 0, unchecked: 0, matched: 3 })
  })
})

describe('the package "next" in lists (app-09 live run, next/nuxt/astro)', () => {
  const N1 = F.N1
  it('names the package in "5 for next, 4 for nuxt", but not the word in "the next month"', () => {
    // Three packages are named in the clause, so the count cannot be given to one of them: unchecked, never rejected.
    expect(counts('The detector found 5 unusual days for next, 4 for nuxt and 3 for astro.', N1)).toMatchObject({ matched: 0, rejected: 0 })
    expect(counts('Next.js had 5 unusual days; nuxt had 4.', N1)).toMatchObject({ rejected: 0 })
    expect(outcome('Over the next month nuxt is expected to hold 3.2% of the selection.', N1)).toBe('matched') // nuxt's share; "next" is not named
    expect(outcome('Over the next month nuxt is expected to hold 88.7% of the selection.', N1)).toBe('unchecked') // next's share
  })
})

describe('the saved live runs, with the claims the model wrote (next/nuxt/astro 90 d, react/vue/svelte 30 d, the two SDKs 365 d)', () => {
  const runs = liveRuns as unknown as Record<string, { summary: Summary; result: string; claimsRaw: string }>
  it.each([
    ['N2', 26, 8],
    ['C2', 30, 5],
    ['M2', 26, 4],
    ['P2', 24, 5],
    ['C3', 24, 6],
    ['N3', 30, 4],
  ])('%s: no rejected figure, at most a few unchecked', (key, minMatched, maxUnchecked) => {
    const run = runs[key]
    const check = checkClaims(run.result, parseClaims(run.claimsRaw) ?? [], run.summary)
    expect(check.rejected).toEqual([])
    expect(check.matched).toBeGreaterThanOrEqual(minMatched)
    expect(check.unchecked.length).toBeLessThanOrEqual(maxUnchecked)
  })
})
