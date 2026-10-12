import { describe, expect, it } from 'vitest'
import {
  CHECK_REQUEST_LIMIT_MS, CHECK_WATCHDOG_MS, MAX_CLAIMS, decidedWithoutModel, deriveVerdict, extractClaims, locateSpan, sentencePieces, settleClaim, summarizeViews, viewOf,
  type CheckSource, type Judgment, type Verdict,
} from '../../netlify/shared/citecheck'
import { parseJudgments } from '../../netlify/shared/citerun'
import { bodyOf, withSources, type SourcePack } from '../../netlify/shared/sourcepack'

// The extract the Sources step held for "James Webb Space Telescope sunshield" (SP2 r3, item7-double).
const SUNSHIELD =
  'The James Webb Space Telescope (JWST) sunshield is a passive thermal control system deployed post-launch to shield the telescope and instrumentation from the light and heat of the Sun, Earth, and Moon. By keeping the telescope and instruments in permanent shadow, it allows them to cool to their design temperature of 40 kelvins (−233 °C; −388 °F). Its intricate deployment was successfully completed on January 4, 2022, ten days after launch, when it was more than 0.8 million kilometers (500,000 mi) away from Earth.'
const SOURCES: CheckSource[] = [
  { n: 1, title: 'James Webb Space Telescope', summary: 'The James Webb Space Telescope (JWST) is a space telescope designed to conduct infrared astronomy.' },
  { n: 2, title: 'James Webb Space Telescope sunshield', summary: SUNSHIELD },
]
const PLANTED = 'Once in place, the telescope settled into its operating position, more than 0.8 million kilometers from Earth [2].'
const CONTROL = 'Its sunshield deployment was completed on January 4, 2022, ten days after launch [2].'

const yes = { sourceSupports: 'yes', subjectMatches: 'yes', causeMatches: 'not_applicable', allPartsCovered: 'yes' } as const
const NO_SPANS = { found: 0, missed: 0, joined: 0, strong: 0 }
const STRONG = { found: 1, missed: 0, joined: 0, strong: 1 }

describe('deriveVerdict', () => {
  it('is supported only when every answer passes and one found span has three words or more', () => {
    expect(deriveVerdict(yes, STRONG)).toBe('supported')
    expect(deriveVerdict(yes, { ...STRONG, found: 2 })).toBe('supported')
  })

  it('is unverified when every answer passes but the quote is missing, not found, joined or too short', () => {
    expect(deriveVerdict(yes, NO_SPANS)).toBe('unverified')
    expect(deriveVerdict(yes, { ...STRONG, missed: 1 })).toBe('unverified')
    expect(deriveVerdict(yes, { ...STRONG, joined: 1 })).toBe('unverified')
    expect(deriveVerdict(yes, { found: 1, missed: 0, joined: 0, strong: 0 })).toBe('unverified')
  })

  it('is partly when any of the other three answers fails, however good the quote', () => {
    expect(deriveVerdict({ ...yes, subjectMatches: 'no' }, STRONG)).toBe('partly')
    expect(deriveVerdict({ ...yes, causeMatches: 'no' }, STRONG)).toBe('partly')
    expect(deriveVerdict({ ...yes, allPartsCovered: 'no' }, STRONG)).toBe('partly')
  })

  it('is unsupported when the source does not state the claim', () => {
    expect(deriveVerdict({ ...yes, sourceSupports: 'no' }, STRONG)).toBe('unsupported')
  })
})

describe('locateSpan on the sunshield extract', () => {
  it('finds a passage word for word, ignoring case, spacing and dash variants', () => {
    expect(locateSpan(SUNSHIELD, 'when it was more than 0.8 million kilometers (500,000 mi) away from Earth')).toMatchObject({ status: 'found', words: 13 })
    expect(locateSpan(SUNSHIELD, 'DESIGN  temperature of 40 kelvins (−233 °C')).toMatchObject({ status: 'found' })
  })

  it('does not find words the source never says, so an invented quote cannot confirm a sentence', () => {
    expect(locateSpan(SUNSHIELD, 'settled into its operating position')).toEqual({ status: 'not_found' })
    expect(locateSpan(SUNSHIELD, 'about 1.5 million kilometers from Earth')).toEqual({ status: 'not_found' })
  })

  it('counts a lone word as too short and a join of two passages as two passages', () => {
    expect(locateSpan(SUNSHIELD, 'sunshield')).toEqual({ status: 'too_short' })
    expect(locateSpan(SUNSHIELD, 'passive thermal control system ... ten days after launch')).toMatchObject({ status: 'found', passages: 2 })
  })
})

describe('the planted case: a sentence the source states differently', () => {
  const [planted] = extractClaims(PLANTED)
  const [control] = extractClaims(CONTROL)

  it('is not confirmed when the model says the claim adds what the source does not give, whatever it quotes', () => {
    const judgment: Judgment = {
      id: 1, ...yes, allPartsCovered: 'no',
      spans: [{ source: 2, text: 'when it was more than 0.8 million kilometers (500,000 mi) away from Earth' }],
      uncovered: 'operating position', reason: 'Source gives the distance at deployment.',
    }
    const claim = settleClaim(planted!, SOURCES, judgment)
    expect(claim.verdict).toBe('partly')
    expect(viewOf(claim.verdict)).toBe('not_confirmed')
    expect(claim.uncovered).toBe('operating position')
  })

  it('is not confirmed when the model answers yes to everything but quotes words the source never says', () => {
    const claim = settleClaim(planted!, SOURCES, { id: 1, ...yes, spans: [{ source: 2, text: 'settled into its operating position' }] })
    expect(claim.verdict).toBe('unverified')
    expect(viewOf(claim.verdict)).toBe('not_confirmed')
    expect(claim.reason).toContain('not found in the source')
  })

  it('is confirmed for the faithful control, with a quote that is in the source', () => {
    const claim = settleClaim(control!, SOURCES, { id: 1, ...yes, spans: [{ source: 2, text: 'successfully completed on January 4, 2022, ten days after launch' }] })
    expect(claim.verdict).toBe('supported')
    expect(viewOf(claim.verdict)).toBe('confirmed')
  })

  it('takes a quote from another source the sentence cites, never from one it does not cite', () => {
    const [both] = extractClaims('The telescope observes in infrared [1][2].')
    const fromOne = settleClaim(both!, SOURCES, { id: 1, ...yes, spans: [{ source: 2, text: 'space telescope designed to conduct infrared astronomy' }] })
    expect(fromOne.verdict).toBe('supported')
    const [only2] = extractClaims('The telescope observes in infrared [2].')
    expect(settleClaim(only2!, SOURCES, { id: 1, ...yes, spans: [{ source: 1, text: 'space telescope designed to conduct infrared astronomy' }] }).verdict).toBe('unverified')
  })

  it('does not confirm a number changed in an otherwise true sentence', () => {
    const rust: CheckSource[] = [{ n: 1, title: 'Rust', summary: 'Rust reached version 1.0 in 2015, with a stable release.' }]
    const [changed] = extractClaims('Rust reached version 1.0 in 2017 [1].')
    const claim = settleClaim(changed!, rust, { id: 1, ...yes, allPartsCovered: 'no', spans: [{ source: 1, text: 'Rust reached version 1.0 in 2015' }] })
    expect(viewOf(claim.verdict)).toBe('not_confirmed')
    const [true_] = extractClaims('Rust reached version 1.0 in 2015 [1].')
    expect(viewOf(settleClaim(true_!, rust, { id: 1, ...yes, spans: [{ source: 1, text: 'Rust reached version 1.0 in 2015' }] }).verdict)).toBe('confirmed')
  })
})

describe('what the page shows', () => {
  it('shows only a supported verdict as confirmed', () => {
    const all: Verdict[] = ['supported', 'partly', 'unsupported', 'unverified', 'unchecked']
    expect(all.filter(verdict => viewOf(verdict) === 'confirmed')).toEqual(['supported'])
    expect(viewOf('unchecked')).toBe('not_checked')
    expect(all.filter(verdict => viewOf(verdict) === 'not_confirmed')).toEqual(['partly', 'unsupported', 'unverified'])
  })

  it('counts a sentence still being checked as not checked in the tally', () => {
    expect(summarizeViews(['confirmed', 'not_confirmed', 'not_checked', 'checking'])).toEqual({ total: 4, confirmed: 1, notConfirmed: 1, notChecked: 2 })
  })

  it('has a browser wait of the server limit plus 3 s, never past the 30 s platform cut', () => {
    expect(CHECK_REQUEST_LIMIT_MS).toBeLessThanOrEqual(26_000)
    expect(CHECK_WATCHDOG_MS).toBe(CHECK_REQUEST_LIMIT_MS + 3_000)
    expect(CHECK_WATCHDOG_MS).toBeLessThanOrEqual(30_000)
  })
})

describe('extractClaims', () => {
  it('numbers cited sentences in reading order across paragraphs, lists and headings, with the sentence before as context', () => {
    const body = '# Intro [1]\n\nFirst fact [1]. It is big. Second fact [2].\n\n- Item one [1].\n- Item two.\n'
    const claims = extractClaims(body)
    expect(claims.map(claim => [claim.id, claim.text, claim.cites])).toEqual([
      [1, 'Intro [1]', [1]],
      [2, 'First fact [1].', [1]],
      [3, 'Second fact [2].', [2]],
      [4, 'Item one [1].', [1]],
    ])
    expect(claims[2]?.context).toBe('It is big.')
  })

  it('leaves out the appended Sources list, whose lines carry markers of their own', () => {
    const pack: SourcePack = { sources: [{ n: 1, kind: 'wikipedia', title: 'Rust', url: 'https://en.wikipedia.org/wiki/Rust', summary: 'Rust is a language.' }], notes: [] }
    const piece = withSources('Rust is a language [1]. It is fast.', pack, 'Blog Post')
    expect(piece).toContain('- [1] [Rust]')
    expect(extractClaims(piece).length).toBeGreaterThan(1)
    expect(extractClaims(bodyOf(piece)).map(claim => claim.text)).toEqual(['Rust is a language [1].'])
  })

  it('splits sentences the same way the page does, and joins back to the line', () => {
    const line = 'Dr. Lee said so [1]. Next, e.g. this one [2]. Done.'
    expect(sentencePieces(line).join('')).toBe(line)
    expect(extractClaims(line).map(claim => claim.id)).toEqual([1, 2])
  })

  it('has a limit on the sentences one check takes', () => {
    expect(MAX_CLAIMS).toBe(12)
  })
})

describe('decidedWithoutModel', () => {
  it('is not confirmed, with no model call, when the sentence cites a source that is not in the list', () => {
    const [claim] = extractClaims('Something is true [9].')
    expect(decidedWithoutModel(claim!, SOURCES)).toMatchObject({ verdict: 'unsupported' })
    const [listed] = extractClaims('Something is true [2].')
    expect(decidedWithoutModel(listed!, SOURCES)).toBeNull()
  })
})

describe('parseJudgments', () => {
  const entry = { id: 1, source_supports: 'yes', subject_matches: 'yes', cause_matches: 'not_applicable', all_parts_covered: 'yes', spans: [{ source: 2, text: 'ten days after launch' }], uncovered: '', reason: 'ok' }

  it('reads the typed answers and ignores a verdict the model sends', () => {
    const [judgment] = parseJudgments(JSON.stringify({ results: [{ ...entry, verdict: 'supported', source_supports: 'no' }] }))
    expect(judgment).toMatchObject({ id: 1, sourceSupports: 'no' })
    expect(judgment).not.toHaveProperty('verdict')
  })

  it('ignores an entry with an invalid answer or a repeated id, and a reply that is not one JSON object', () => {
    expect(parseJudgments(JSON.stringify({ results: [{ ...entry, subject_matches: 'maybe' }] }))).toEqual([])
    expect(parseJudgments(JSON.stringify({ results: [entry, { ...entry, source_supports: 'no' }] }))).toHaveLength(1)
    expect(parseJudgments('{"results":[{"id":1,')).toEqual([])
    expect(parseJudgments('not json')).toEqual([])
  })

  it('reads a reply in a code fence', () => {
    expect(parseJudgments(`\`\`\`json\n${JSON.stringify({ results: [entry] })}\n\`\`\``)).toHaveLength(1)
  })
})
