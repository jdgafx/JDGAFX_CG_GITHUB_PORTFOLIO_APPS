import { describe, expect, it } from 'vitest'
import { checkClaims, ClaimSplitter, CLAIMS_MARKER, describeClaimCheck, parseClaims, resolvePackage, splitAnswer, type Claim } from '../../netlify/shared/claims'
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
    expect(wrong.rejected).toEqual([{ figure: '1.5 times', quote: '1.5 times' }])
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
      ['504,907 downloads on the day', claim('504,907', 'spike_downloads', ['sdk'], { d: '2026-01-31' }), true],
      ['504,907 downloads on the day', claim('504,907', 'spike_baseline', ['sdk']), false],
      ['87% over usual', claim('87%', 'spike_pct', ['sdk']), true],
      ['the selection moved 14.4 billion downloads', claim('14.4 billion', 'total', []), true],
    ]
    for (const [text, c, ok] of cases) {
      expect(checkClaims(text, [c], S).matched, `${text} / ${c.k} / ${c.p}`).toBe(ok ? 1 : 0)
    }
  })

  it('checks dates and versions against the named package only', () => {
    const text = 'Release 0.72.1 landed on January 30 before the spike on 2026-01-31.'
    const ok = checkClaims(text, [claim('0.72.1', 'version', ['sdk']), claim('January 30', 'date', ['sdk']), claim('2026-01-31', 'date', ['sdk'])], S)
    expect(ok).toMatchObject({ checked: 3, matched: 3, rejected: [] })
    const wrong = checkClaims(text, [claim('0.72.1', 'version', ['react'])], S)
    expect(wrong.rejected).toEqual([{ figure: '0.72.1', quote: '0.72.1' }])
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
    const text = "It is 1.4 times react's and 9.4 times the SDK's."
    const check = checkClaims(text, [claim("1.4 times react's and 9.4 times", 'multiple', ['zod', 'react'])], S)
    // The first figure is claimed. The second is not covered, and its sentence names only react, so it is unchecked.
    expect(check).toMatchObject({ checked: 1, matched: 1, rejected: [], unchecked: ['9.4 times'] })
  })
})

describe('claims written loosely', () => {
  it('reads p as one string, splits several names run together, and ignores an empty date', () => {
    const [loose] = parseClaims('[{"q":"1.4 times","k":"multiple","p":"zod react","d":""}]') ?? []
    expect(loose).toEqual({ q: '1.4 times', k: 'multiple', p: ['zod react'] })
    expect(checkClaims("It is 1.4 times react's.", [loose], S)).toMatchObject({ checked: 1, matched: 1, rejected: [] })
  })
})
