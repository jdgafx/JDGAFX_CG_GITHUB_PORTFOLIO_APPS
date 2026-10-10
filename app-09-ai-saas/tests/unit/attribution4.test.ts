import { describe, expect, it } from 'vitest'
import { sentenceSpans } from '../../netlify/shared/boundaries'
import { checkClaims } from '../../netlify/shared/claimCheck'
import type { Claim } from '../../netlify/shared/claims'
import type { Summary } from '../../netlify/shared/contract'
import fixtures from '../fixtures/live-summaries.json'

/** Repros from the fifth live verification (app-09j): range direction, weekend level against gap, a missing space, comparisons with the past. */
const F = fixtures as unknown as Record<string, Summary>
const C1 = { ...F.C1, spikeCounts: { react: 0, vue: 2, svelte: 1 } }
const N1 = F.N1 // nuxt: weekend level 42.7, gap 57.3
const claim = (q: string, k: Claim['k'], p: string[]): Claim => ({ q, k, p })
type Outcome = 'matched' | 'unchecked' | 'rejected'
function outcome(text: string, summary: Summary, claims: Claim[] = []): Outcome {
  const c = checkClaims(text, claims, summary)
  if (c.rejected.length > 0) return 'rejected'
  if (c.unchecked.length > 0 || c.matched === 0) return 'unchecked'
  return 'matched'
}

describe('a range keeps the direction of the words before it (D25)', () => {
  it.each([
    ['Vue and Svelte fell 12 to 21%.', 'unchecked'], // both grew
    ['Vue and Svelte fell between 12% and 21%.', 'unchecked'],
    ['Vue and Svelte grew 12 to 21%.', 'matched'],
    ['Vue and Svelte grew by about 12-21%.', 'matched'],
    ['Vue and Svelte rose between 12% and 21%.', 'matched'],
    ['Vue and Svelte changed 12 to 21%.', 'matched'], // no direction word: only the size is judged
  ] as [string, Outcome][])('%s', (text, expected) => {
    expect(outcome(text, C1)).toBe(expected)
  })

  it('does the same when the range is claimed', () => {
    expect(outcome('Vue and Svelte fell 12 to 21%.', C1, [claim('fell 12 to 21%', 'change_pct', ['vue'])])).toBe('unchecked')
    expect(outcome('Vue and Svelte grew 12 to 21%.', C1, [claim('grew 12 to 21%', 'change_pct', ['vue'])])).toBe('matched')
  })
})

describe('the weekend level and the gap are two figures (D26)', () => {
  it.each([
    ['Nuxt keeps 57.3% of its weekday downloads on weekends.', 'unchecked'], // 57.3 is the gap
    ['Nuxt keeps 42.7% of its weekday downloads on weekends.', 'matched'],
    ["Nuxt's weekend downloads run at 42.7% of weekdays.", 'matched'],
    ["Nuxt's weekend downloads run at 57.3% of weekdays.", 'unchecked'],
    ["Nuxt's weekend downloads are 57.3% lower than weekdays.", 'matched'],
    ["Nuxt's weekend downloads are 42.7% lower than weekdays.", 'unchecked'],
    ["Nuxt's weekend downloads show a 57.3% drop.", 'matched'],
    ['Nuxt weekends: 57.3%.', 'unchecked'], // no words say which
  ] as [string, Outcome][])('%s', (text, expected) => {
    expect(outcome(text, N1)).toBe(expected)
  })

  it('does the same for a claim: a wrong level is rejected, and one with no such words is unchecked', () => {
    const t = 'Nuxt keeps 57.3% of its weekday downloads on weekends.'
    expect(outcome(t, N1, [claim('keeps 57.3% of its weekday downloads', 'weekend_pct', ['nuxt'])])).toBe('rejected') // a level of 57.3 is wrong: that is the gap
    expect(outcome(t.replace('57.3', '42.7'), N1, [claim('keeps 42.7% of its weekday downloads', 'weekend_pct', ['nuxt'])])).toBe('matched')
    expect(outcome('Nuxt weekends: 57.3%.', N1, [claim('57.3%', 'weekend_pct', ['nuxt'])])).toBe('unchecked')
  })
})

describe('a sentence that ends with no space after it (D27)', () => {
  it('ends at a full stop that follows a digit, a percent sign or a bracket and meets a capital', () => {
    const t = 'Svelte grew 20.5%.Vue grew 12.4%. React 13.3%.Done (see 3).Next.'
    expect(sentenceSpans(t).map((s) => t.slice(s.start, s.end))).toEqual(['Svelte grew 20.5%', 'Vue grew 12.4%', ' React 13.3%', 'Done (see 3)', 'Next', ''])
  })
})

describe('a multiple that compares something with its own past (G14)', () => {
  it.each([
    'Next.js is 2 to 3 times faster than before.',
    'React is about 4 times larger than last year.',
    'Vue is 11 times bigger than previously.',
  ])('%s is unchecked', (text) => {
    expect(outcome(text, C1)).toBe('unchecked')
    expect(outcome(text, C1, [claim(text.replace(/\.$/, ''), 'multiple', ['react', 'vue'])])).toBe('unchecked')
  })
  it('still judges a real ratio', () => {
    expect(outcome('React is about 11 times larger than Vue.', C1)).toBe('matched')
  })
})

describe('"next" as a package at the end of a sentence, and a figure tied to its package in a pronoun clause (live run)', () => {
  const next = N1.packages[0]
  it('reads "concentrated in next." as the package, so "It logged ..." is next\'s', () => {
    const total = next.total.toLocaleString('en-US')
    expect(outcome(`Install volume is concentrated in next. It logged ${total} downloads.`, N1)).toBe('matched')
    expect(outcome('Over the next month it logs more.', N1)).toBe('unchecked')
  })

  it('lets "for X" tie a figure to X inside a clause that opens with a pronoun', () => {
    expect(outcome('Astro is the fastest by change. Its change is +48%, against +26% for next and +25.1% for nuxt.', N1)).toBe('matched')
    expect(outcome('Astro is the fastest by change. Its change is +48%, against +25.1% for next and +26% for nuxt.', N1)).toBe('unchecked')
  })
})

describe('weekend level and gap, whichever way round and wherever the words are (D26b)', () => {
  const counts = (text: string) => {
    const c = checkClaims(text, [], N1)
    return { matched: c.matched, unchecked: c.unchecked.length, rejected: c.rejected.length }
  }
  it.each([
    ['Nuxt weekend traffic is 57.3% of weekday levels (42.7% lower).', { matched: 0, unchecked: 2 }], // swapped
    ['Nuxt weekend traffic is 42.7% of weekday levels (57.3% lower).', { matched: 2, unchecked: 0 }],
    ['Nuxt weekend traffic is 57.3% of weekday levels, 42.7% lower.', { matched: 0, unchecked: 2 }],
    ['Nuxt weekend traffic is 42.7% of weekday levels, 57.3% lower.', { matched: 2, unchecked: 0 }],
    ['Nuxt loses 57.3% on weekends.', { matched: 1, unchecked: 0 }],
    ['Nuxt loses 42.7% on weekends.', { matched: 0, unchecked: 1 }],
    ['Nuxt weekends: 42.7%.', { matched: 0, unchecked: 1 }], // no words say which
    ['Nuxt loses 42.7% of its downloads at weekends.', { matched: 0, unchecked: 1 }], // "of" after the figure is not "of weekday"
    ['Nuxt loses 57.3% of its downloads at weekends.', { matched: 1, unchecked: 0 }],
    ['Nuxt drops to 42.7% of weekday downloads at weekends.', { matched: 1, unchecked: 0 }], // "of weekday" makes it the level
    ['Nuxt drops to 57.3% of weekday downloads at weekends.', { matched: 0, unchecked: 1 }],
  ] as [string, { matched: number; unchecked: number }][])('%s', (text, expected) => {
    expect(counts(text)).toMatchObject({ ...expected, rejected: 0 })
  })
})

describe('a bound is true when the real value is on its side (D30)', () => {
  // next / astro by total is 10.865; react's total is 791 million and its share 88.9%.
  const text = (words: string) => `Next.js is ${words} Astro's total.`
  const next = ['next', 'astro']
  it.each([
    ['more than 10 times', 'matched'],
    ['over 10 times', 'matched'],
    ['at least 10 times', 'matched'],
    ['more than 12 times', 'unchecked'],
    ['less than 11 times', 'matched'],
    ['under 12 times', 'matched'],
    ['at most 10 times', 'unchecked'],
    ['nearly 11 times', 'matched'],
  ] as [string, Outcome][])('%s (sentence check)', (words, expected) => {
    expect(outcome(text(words + "'"), N1)).toBe(expected === 'matched' ? 'matched' : 'unchecked')
  })

  it('rejects a false bound when a claim covers it, and accepts a true one', () => {
    expect(outcome(text('more than 12 times'), N1, [claim('more than 12 times', 'multiple', next)])).toBe('rejected')
    expect(outcome(text('more than 10 times'), N1, [claim('more than 10 times', 'multiple', next)])).toBe('matched')
    expect(outcome(text('less than 10 times'), N1, [claim('less than 10 times', 'multiple', next)])).toBe('rejected')
    expect(outcome(text('less than 11 times'), N1, [claim('less than 11 times', 'multiple', next)])).toBe('matched')
  })

  it('works for counts and percentages', () => {
    expect(outcome('React had over 700 million downloads in total.', C1)).toBe('matched')
    expect(outcome('React had over 900 million downloads in total.', C1)).toBe('unchecked')
    expect(outcome('React had under 900 million downloads in total.', C1)).toBe('matched')
    expect(outcome('React holds more than 85% of the selection.', C1)).toBe('matched')
    expect(outcome('React holds more than 95% of the selection.', C1)).toBe('unchecked')
    expect(outcome('React had over 900 million downloads in total.', C1, [claim('over 900 million downloads in total', 'total', ['react'])])).toBe('rejected')
  })
})
