import { describe, expect, it } from 'vitest'
import { checkClaims, describeClaimCheck } from '../../netlify/shared/claimCheck'
import { ClaimSplitter, CLAIMS_MARKER, parseClaims, resolvePackage, splitAnswer, type Claim } from '../../netlify/shared/claims'
import type { Summary } from '../../netlify/shared/contract'

// The live selection: zod 7.854 billion, react 5.7 billion, @anthropic-ai/sdk 834.9 million.
// zod / react = 1.378 and zod / sdk = 9.407 by total.
const S: Summary = {
  startDate: '2025-10-08',
  endDate: '2026-10-07',
  windowDays: 365,
  observedDays: 358,
  packages: [
    { name: 'zod', total: 7_854_000_000, avgPerDay: 21_937_500, changePct: 189.9, weekendPct: 53.9, sharePct: 40.1 },
    { name: 'react', total: 5_700_000_000, avgPerDay: 15_921_788, changePct: 122.5, weekendPct: 55.8, sharePct: 29.1 },
    { name: '@anthropic-ai/sdk', total: 834_900_000, avgPerDay: 2_332_000, changePct: 459.8, weekendPct: 60.6, sharePct: 4.3 },
  ],
  spikes: [
    {
      name: '@anthropic-ai/sdk',
      date: '2026-01-31',
      downloads: 504_907,
      baseline: 269_287,
      sizePct: 87,
      releases: [{ version: '0.72.1', date: '2026-01-30', kind: 'patch' }],
      moreReleases: 0,
      releasesKnown: true,
    },
  ],
}
const claim = (q: string, k: Claim['k'], p: string[], extra: Partial<Claim> = {}): Claim => ({ q, k, p, ...extra })

describe('ClaimSplitter and splitAnswer', () => {
  it('passes the explanation through and holds back the claims', () => {
    const splitter = new ClaimSplitter()
    const shown = ['Zod leads. ', 'Next.\n===CLA', 'IMS===\n[{"q":"x"}]'].map((chunk) => splitter.push(chunk)).join('') + splitter.flush()
    expect(shown).toBe('Zod leads. Next.')
    expect(splitter.found).toBe(true)
  })

  it('flushes everything when no marker ever arrives', () => {
    const splitter = new ClaimSplitter()
    const shown = ['No claims ', 'here at all, just a long enough text.'].map((chunk) => splitter.push(chunk)).join('') + splitter.flush()
    expect(shown).toBe('No claims here at all, just a long enough text.')
  })

  it('splits a whole answer at the marker', () => {
    expect(splitAnswer(`Text.\n${CLAIMS_MARKER}\n[]`)).toEqual({ explanation: 'Text.', claimsRaw: '[]' })
    expect(splitAnswer('Text only.')).toEqual({ explanation: 'Text only.', claimsRaw: null })
  })
})

describe('parseClaims', () => {
  it('reads an array, with or without a code fence', () => {
    const json = '[{"q":"9.4 times","k":"multiple","p":["zod","SDK"],"m":"total"}]'
    expect(parseClaims(json)).toEqual([{ q: '9.4 times', k: 'multiple', p: ['zod', 'SDK'], m: 'total' }])
    expect(parseClaims('```json\n' + json + '\n```')).toHaveLength(1)
  })

  it('refuses anything that is not the expected shape', () => {
    expect(parseClaims('not json')).toBeNull()
    expect(parseClaims('{"q":"x"}')).toBeNull()
    expect(parseClaims('[{"q":"x","k":"mystery","p":[]}]')).toBeNull()
    expect(parseClaims('[{"q":"","k":"total","p":[]}]')).toBeNull()
    expect(parseClaims('[{"q":"x","k":"total","p":[1]}]')).toBeNull()
  })
})

describe('resolvePackage', () => {
  const names = S.packages.map((p) => p.name)
  it.each([
    ['zod', 'zod'],
    ['Zod', 'zod'],
    ['the SDK', '@anthropic-ai/sdk'],
    ['sdk', '@anthropic-ai/sdk'],
    ['Anthropic SDK', '@anthropic-ai/sdk'],
    ['@anthropic-ai/sdk', '@anthropic-ai/sdk'],
    ['the react package', 'react'],
  ])('%s is %s', (said, expected) => {
    expect(resolvePackage(said, names)).toBe(expected)
  })

  it('gives null for a package that is not selected or an ambiguous word', () => {
    expect(resolvePackage('vue', names)).toBeNull()
    expect(resolvePackage('ai', [...names, 'ai'])).toBe('ai')
    expect(resolvePackage('anthropic', [...names, '@anthropic-ai/other'])).toBeNull()
  })
})

describe('checkClaims', () => {
  const TEXT = "Zod leads with 7.85 billion downloads. It is roughly 1.4 times react's total and about 9.4 times the SDK's."

  it('accepts the live sentence: 1.378 as 1.4 and 9.407 as 9.4, with the SDK named by its short form', () => {
    const check = checkClaims(
      TEXT,
      [claim('7.85 billion', 'total', ['zod']), claim('1.4 times', 'multiple', ['zod', 'react'], { m: 'total' }), claim('9.4 times', 'multiple', ['zod', 'the SDK'], { m: 'total' })],
      S,
    )
    expect(check).toMatchObject({ checked: 3, matched: 3, rejected: [], unchecked: [], ignored: 0 })
    expect(describeClaimCheck(check)).toBe('3 of 3 figures match the summary and spike evidence')
  })

  it('rejects 1.5 for 1.378, and the right ratio of the wrong pair', () => {
    const wrong = checkClaims("Zod is about 1.5 times react's total.", [claim('1.5 times', 'multiple', ['zod', 'react'])], S)
    expect(wrong.rejected).toEqual([{ figure: '1.5 times', quote: '1.5 times', start: 13, end: 22 }])
    expect(describeClaimCheck(wrong)).toBe('0 of 1 figure matches the summary and spike evidence. Not in the summary: 1.5 times')
    // 9.4 is zod / sdk, not zod / react.
    expect(checkClaims("Zod is 9.4 times react's total.", [claim('9.4 times', 'multiple', ['zod', 'react'])], S).rejected).toHaveLength(1)
  })

  it('reads a sentence that opens with This or That and names its own subject', () => {
    const text = "React is large. That package, zod, is 9.4 times the SDK's size."
    const check = checkClaims(text, [claim('9.4 times', 'multiple', ['zod', 'sdk'])], S)
    expect(check).toMatchObject({ checked: 1, matched: 1, rejected: [] })
  })

  it('accepts a multiple stated either way round, and by per-day figures when metric is not given', () => {
    expect(checkClaims('The SDK is 0.1 times zod.', [claim('0.1 times', 'multiple', ['sdk', 'zod'])], S).matched).toBe(1)
    // zod / react per day is 21,937,500 / 15,921,788 = 1.378 too, but 21,937,500 / 2,332,000 = 9.407.
    expect(checkClaims('Zod is 9.4 times the SDK per day.', [claim('9.4 times', 'multiple', ['zod', 'sdk'], { m: 'per_day' })], S).matched).toBe(1)
  })

  it('judges each kind against the one value it names', () => {
    const cases: [string, Claim, boolean][] = [
      ['react averages 15.9 million a day', claim('15.9 million', 'per_day', ['react']), true],
      ['react averages 15.9 million a day', claim('15.9 million', 'total', ['react']), false],
      ['zod holds 40.1% of the selection', claim('40.1%', 'share_pct', ['zod']), true],
      ['zod holds 40.1% of the selection', claim('40.1%', 'share_pct', ['react']), false],
      ['the SDK grew +459.8%', claim('+459.8%', 'change_pct', ['sdk']), true],
      ['the SDK fell 459.8%', claim('459.8%', 'change_pct', ['sdk']), false],
      ['react weekends sit 44.2% lower', claim('44.2%', 'weekend_pct', ['react']), true],
      ['react weekends run at 55.8% of weekdays', claim('55.8%', 'weekend_pct', ['react']), true],
      ['the SDK had 504,907 downloads on the day', claim('504,907', 'spike_downloads', ['sdk'], { d: '2026-01-31' }), true],
      ['the SDK had 504,907 downloads on the day', claim('504,907', 'spike_baseline', ['sdk']), false],
      ['the SDK ran 87% over usual', claim('87%', 'spike_pct', ['sdk']), true],
      ['the selection moved 14.4 billion downloads', claim('14.4 billion', 'total', []), true],
    ]
    for (const [text, c, ok] of cases) {
      expect(checkClaims(text, [c], S).matched, `${text} / ${c.k} / ${c.p}`).toBe(ok ? 1 : 0)
    }
  })

  it('checks dates and versions against the named package only', () => {
    const text = "The SDK's release 0.72.1 landed on January 30 before the spike on 2026-01-31."
    const ok = checkClaims(text, [claim('0.72.1', 'version', ['sdk']), claim('January 30', 'date', ['sdk']), claim('2026-01-31', 'date', ['sdk'])], S)
    expect(ok).toMatchObject({ checked: 3, matched: 3, rejected: [] })
    const wrong = checkClaims('React shipped 0.72.1 that day.', [claim('0.72.1', 'version', ['react'])], S)
    expect(wrong.rejected).toMatchObject([{ figure: '0.72.1', quote: '0.72.1' }])
  })

  it('sets aside a claim whose quote is not in the explanation, then reads its figure by sentence', () => {
    const check = checkClaims('Zod holds 40.1% of the selection.', [claim('forty percent of it', 'share_pct', ['zod'])], S)
    expect(check).toMatchObject({ ignored: 1, rejected: [], checked: 1, matched: 1 })
  })

  it('sets aside a claim for a package that is not selected, and one whose quote holds no matching figure', () => {
    expect(checkClaims('Vue has 2.0 million.', [claim('2.0 million', 'total', ['vue'])], S).ignored).toBe(1)
    expect(checkClaims('Zod has plenty.', [claim('Zod has plenty', 'total', ['zod'])], S).ignored).toBe(1)
  })

  it('shows figures no claim covers as unchecked, never as rejected, and still matches those it can read', () => {
    const text = 'Zod holds 40.1% of the selection and weekends run at 12.3% of weekdays, with 4.3% for the SDK.'
    const check = checkClaims(text, [claim('40.1%', 'share_pct', ['zod'])], S)
    // 40.1 is claimed; 4.3 is matched by the sentence check; 12.3 is in no figure, so it is unchecked.
    expect(check).toMatchObject({ checked: 2, matched: 2, rejected: [], unchecked: ['12.3%'] })
    expect(describeClaimCheck(check)).toBe('2 of 2 figures match the summary and spike evidence; 1 unchecked')
  })

  it('does not let one claim cover a second figure in the same quote', () => {
    const text = "Zod leads. It is 1.4 times react's and 9.4 times the SDK's."
    const check = checkClaims(text, [claim("1.4 times react's and 9.4 times", 'multiple', ['zod', 'react'])], S)
    // The first figure is claimed. The second is not covered: the sentence names the SDK, and with the subject carried
    // from the sentence before it, zod / sdk is 9.4, so the sentence check matches it.
    expect(check).toMatchObject({ checked: 2, matched: 2, rejected: [], unchecked: [] })
  })
})

describe('claims written loosely', () => {
  it('reads p as one string, splits several names run together, and ignores an empty date', () => {
    const [loose] = parseClaims('[{"q":"1.4 times","k":"multiple","p":"zod react","d":""}]') ?? []
    expect(loose).toEqual({ q: '1.4 times', k: 'multiple', p: ['zod react'] })
    expect(checkClaims("Zod is big. It is 1.4 times react's.", [loose], S)).toMatchObject({ checked: 1, matched: 1, rejected: [] })
  })
})

describe('attribution: the text must speak of the packages the claim names', () => {
  // Three probes from the live check, each claimed for the wrong packages, plus the correct sentence.
  const unchecked = (text: string, c: Claim) => {
    const check = checkClaims(text, [c], S)
    return { matched: check.matched, rejected: check.rejected.length, unchecked: check.unchecked }
  }

  it('does not accept a right ratio claimed for a pair the sentence does not name', () => {
    // zod / sdk is 9.4, but the sentence is about react and the SDK.
    // react / sdk is 6.8, so no pair the sentence names gives 9.4: it is wrong, not merely misfiled.
    expect(unchecked('React is about 9.4 times the Anthropic SDK.', claim('9.4 times', 'multiple', ['zod', 'sdk']))).toEqual({ matched: 0, rejected: 1, unchecked: [] })
  })

  it("does not borrow a pair from elsewhere in the sentence: the quote's own neighbours decide", () => {
    const text = "Zod is roughly 30 times react's 5.7 billion total and about 9.4 times the SDK's total."
    // 30 times react is wrong (1.4), and "react" is its neighbour, so it is rejected, not borrowed onto zod / sdk.
    const borrowed = checkClaims(text, [claim("30 times react's 5.7 billion", 'multiple', ['zod', 'sdk'])], S)
    expect(borrowed.rejected.map((r) => r.figure)).toEqual(['30 times'])
    expect(checkClaims(text, [claim('9.4 times', 'multiple', ['zod', 'sdk'])], S)).toMatchObject({ rejected: [], unchecked: ['30 times'] })
  })

  it('does not accept a weekend gap claimed for a package the sentence does not name', () => {
    expect(unchecked('React weekends sit 44.2% lower.', claim('44.2%', 'weekend_pct', ['zod'])).matched).toBe(0)
    expect(unchecked('React weekends sit 44.2% lower.', claim('44.2%', 'weekend_pct', ['react'])).matched).toBe(1)
  })

  it('keeps the correct sentence with the subject first: the SDK is 9.4 times smaller than zod', () => {
    const text = 'The Anthropic SDK is much smaller, about 9.4 times fewer than Zod.'
    expect(checkClaims(text, [claim('9.4 times', 'multiple', ['sdk', 'zod'])], S)).toMatchObject({ checked: 1, matched: 1, rejected: [], unchecked: [] })
    // The subject must be p[0]: named the other way round, the figure is left unchecked.
    expect(unchecked(text, claim('9.4 times', 'multiple', ['zod', 'sdk']))).toEqual({ matched: 0, rejected: 0, unchecked: ['9.4 times'] })
  })

  it('reaches back for the packages when the sentence names none, as in "The gap is about..."', () => {
    const text = 'zod averaged 21,937,500 a day and react averaged 15,921,788. The gap is about 6,015,712 a day.'
    expect(checkClaims(text, [claim('6,015,712 a day', 'difference', ['zod', 'react'], { m: 'per_day' })], S)).toMatchObject({ matched: 3, rejected: [], unchecked: [] })
  })
})

describe('difference claims', () => {
  const text = 'openai averaged 5,386,613 a day and the SDK averaged 5,287,553. The gap is small, about 99,060 per day.'
  const T: Summary = {
    ...S,
    packages: [
      { name: 'openai', total: 1_934_000_000, avgPerDay: 5_386_613, changePct: 1, weekendPct: 50, sharePct: 50 },
      { name: '@anthropic-ai/sdk', total: 1_894_000_000, avgPerDay: 5_287_553, changePct: 2, weekendPct: 50, sharePct: 50 },
    ],
    spikes: [],
  }
  it('accepts |a - b| at the written precision', () => {
    const check = checkClaims(text, [claim('about 99,060 per day', 'difference', ['openai', 'sdk'], { m: 'per_day' })], T)
    expect(check).toMatchObject({ matched: 3, rejected: [], unchecked: [] })
  })

  it('rejects a wrong gap', () => {
    const wrong = text.replace('99,060', '120,000')
    expect(checkClaims(wrong, [claim('about 120,000 per day', 'difference', ['openai', 'sdk'])], T).rejected).toHaveLength(1)
  })

  it('leaves a gap filed as a per-day figure unchecked, not rejected', () => {
    const check = checkClaims(text, [claim('about 99,060 per day', 'per_day', ['openai', 'sdk'])], T)
    expect(check.rejected).toEqual([])
    expect(check.unchecked).toEqual(['99,060'])
  })
})

describe('hedged figures', () => {
  const T: Summary = {
    ...S,
    packages: [
      { name: 'openai', total: 1_934_000_000, avgPerDay: 5_386_613, changePct: 1, weekendPct: 50, sharePct: 50 },
      { name: '@anthropic-ai/sdk', total: 1_894_000_000, avgPerDay: 5_287_553, changePct: 2, weekendPct: 50, sharePct: 50 },
    ],
    spikes: [],
  }
  const gap = (said: string) => checkClaims(`openai averages 5,386,613 a day and the SDK 5,287,553, a gap of ${said} per day.`, [claim(said, 'difference', ['openai', 'sdk'], { m: 'per_day' })], T)

  it.each(['roughly 99,000', 'about 99,000', 'around 99,000', 'approximately 99,000', 'nearly 99,000', 'almost 99,000', 'close to 99,000', 'just over 99,000', '~99,000', 'some 99,000', 'roughly 99,060'])(
    'accepts %s for a true gap of 99,060 (true value rounded to the figure\'s own significant figures)',
    (said) => {
      expect(gap(said).rejected).toEqual([])
    },
  )

  it('still rejects a hedged figure that is not the true value at its own precision', () => {
    expect(gap('roughly 120,000').rejected).toHaveLength(1)
    expect(gap('about 98,000').rejected).toHaveLength(1)
    expect(gap('around 99,500').rejected).toHaveLength(1)
    expect(gap('around 99,100').rejected).toEqual([]) // 99,060 to three significant figures
  })

  it('keeps an unhedged full count exact', () => {
    expect(gap('99,000').rejected).toHaveLength(1)
    expect(gap('a gap of 99,000').rejected).toHaveLength(1)
    expect(gap('99,060').rejected).toHaveLength(0)
  })

  it('does not let a hedge in another sentence soften a figure', () => {
    const text = 'It is about the same. The SDK differs from openai by 99,000 per day.'
    expect(checkClaims(text, [claim('99,000 per day', 'difference', ['openai', 'sdk'], { m: 'per_day' })], T).rejected).toHaveLength(1)
  })

  it('reads multiples at their written decimals, hedged or not', () => {
    // zod / react = 1.378 (written 1.4 passes; 1.5 does not, hedged or not); zod / sdk = 9.407.
    const text = (said: string) => `Zod is ${said} react's total.`
    const run = (said: string) => checkClaims(text(said), [claim(said.replace(/^\w+ /, ''), 'multiple', ['zod', 'react'], { m: 'total' })], S).rejected.length
    expect(run('about 1.4 times')).toBe(0)
    expect(run('about 1.5 times')).toBe(1)
    expect(run('1.5 times')).toBe(1)
    expect(checkClaims("Zod is about 9 times the SDK's total.", [claim('9 times', 'multiple', ['zod', 'sdk'], { m: 'total' })], S).rejected).toEqual([])
    expect(checkClaims("Zod is about 10 times the SDK's total.", [claim('10 times', 'multiple', ['zod', 'sdk'], { m: 'total' })], S).rejected).toHaveLength(1)
  })
})

describe('spike_count claims', () => {
  const sp = (name: string, date: string, releases: number) => ({
    name,
    date,
    downloads: 1000,
    baseline: 500,
    sizePct: 100,
    releases: Array.from({ length: releases }, (_, i) => ({ version: `1.0.${i + 1}`, date, kind: 'patch' as const })),
    moreReleases: 0,
    releasesKnown: true,
  })
  const C: Summary = { ...S, spikes: [sp('@anthropic-ai/sdk', '2026-01-31', 1), sp('@anthropic-ai/sdk', '2026-02-02', 0), sp('zod', '2026-03-26', 0)] }
  const run = (text: string, c: Claim) => checkClaims(text, [c], C)

  it('checks the total, in digits or words', () => {
    expect(run('There are 3 unusual days in all.', claim('3 unusual days', 'spike_count', []))).toMatchObject({ matched: 1, rejected: [] })
    expect(run('There are three unusual days in all.', claim('three unusual days', 'spike_count', []))).toMatchObject({ matched: 1, rejected: [] })
    const wrong = run('There are 8 unusual days in all.', claim('8 unusual days', 'spike_count', []))
    expect(wrong.rejected).toMatchObject([{ figure: '8', start: 10, end: 11 }])
  })

  it('checks a package, only when the text names it', () => {
    expect(run('The SDK has two spike days.', claim('two spike days', 'spike_count', ['sdk']))).toMatchObject({ matched: 1, rejected: [] })
    expect(run('The SDK has three spike days.', claim('three spike days', 'spike_count', ['sdk'])).rejected).toHaveLength(1)
    expect(run('Seven spike days are listed.', claim('Seven spike days', 'spike_count', ['sdk']))).toMatchObject({ matched: 0, rejected: [], unchecked: ['Seven'] })
  })

  it('counts only the spikes with a release, or with none, when the words right after the count say so', () => {
    expect(run('The SDK had one unusual day with a release.', claim('one unusual day with a release', 'spike_count', ['sdk'])).matched).toBe(1)
    expect(run('The SDK had two unusual days with a release.', claim('two unusual days with a release', 'spike_count', ['sdk'])).rejected).toHaveLength(1)
    expect(run('The SDK had one unusual day with no release.', claim('one unusual day with no release', 'spike_count', ['sdk'])).matched).toBe(1)
  })

  it('leaves a partial count such as "the other 10" or "the remaining 8" unchecked', () => {
    for (const quote of ['the remaining 8 spikes', 'the other 10 unusual days', '8 more spikes']) {
      const check = run(`There are ${quote}.`, claim(quote, 'spike_count', []))
      expect(check.rejected).toEqual([])
      expect(check.matched).toBe(0)
      expect(check.unchecked).toHaveLength(1)
    }
  })
})
