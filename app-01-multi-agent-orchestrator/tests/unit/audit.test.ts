import { describe, expect, it } from 'vitest'
import * as audit from '../../src/lib/audit'
import {
  type Judgment,
  citesOf,
  decidedWithoutModel,
  extractClaims,
  findSpan,
  namesIn,
  numbersIn,
  preCheck,
  reportBody,
  sentencePieces,
  settleClaim,
  summarize,
  summaryDetail,
  summaryLine,
} from '../../src/lib/audit'
import type { AuditClaim, Source } from '../../src/types'
import { readFileSync } from 'node:fs'

const JWST =
  'The James Webb Space Telescope (JWST) is a space telescope designed to conduct infrared astronomy. Its 6.5 meter primary mirror lets it see objects too old and distant for Hubble. It launched on 25 December 2021.'

const SOURCES: Source[] = [
  { n: 1, title: 'James Webb Space Telescope', site: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/James_Webb_Space_Telescope', snippet: JWST },
  {
    n: 2,
    title: 'Webb telescope finds early galaxies',
    site: 'Hacker News',
    url: 'https://news.ycombinator.com/item?id=1',
    snippet: 'Webb telescope finds early galaxies',
    note: '764 points, 526 comments, Jan 2023',
  },
]

describe('reportBody', () => {
  it('drops the Sources section and keeps the text before it', () => {
    expect(reportBody('Fact [1].\n\n### Sources\n\n1. [A](https://a.test) - Wikipedia\n')).toBe('Fact [1].')
    expect(reportBody('No sources section')).toBe('No sources section')
  })
})

describe('sentencePieces', () => {
  it('cuts at sentence ends and rejoins to the exact text', () => {
    const text = 'It launched in 2021 [1]. It sees infrared light [1, 2]. Done.'
    const pieces = sentencePieces(text)
    expect(pieces.map(piece => piece.trim())).toEqual(['It launched in 2021 [1].', 'It sees infrared light [1, 2].', 'Done.'])
    expect(pieces.join('')).toBe(text)
  })

  it('keeps a marker that follows the full stop with its sentence', () => {
    expect(sentencePieces('The mirror is large. [1] The orbit is far. [2]').map(piece => piece.trim())).toEqual([
      'The mirror is large. [1]',
      'The orbit is far. [2]',
    ])
  })

  it('does not cut at abbreviations, initials or decimals', () => {
    expect(sentencePieces('Use e.g. Rust or C. Smith wrote 3.5 pages [1].')).toHaveLength(1)
  })
})

describe('citesOf and extractClaims', () => {
  it('reads single and grouped markers without repeats', () => {
    expect(citesOf('A [2] and B [1, 2]; C [3;4]')).toEqual([2, 1, 3, 4])
  })

  it('numbers the cited sentences in reading order and says where each sits', () => {
    const body = ['## Findings', 'Webb saw early galaxies [1]. This is uncited.', '- It launched in 2021 [1].', '- Hubble is older [2].'].join('\n')
    const claims = extractClaims(body)
    expect(claims.map(claim => [claim.id, claim.block, claim.piece, claim.text, claim.cites])).toEqual([
      [1, 1, 0, 'Webb saw early galaxies [1].', [1]],
      [2, 2, 0, 'It launched in 2021 [1].', [1]],
      [3, 3, 0, 'Hubble is older [2].', [2]],
    ])
  })
})

describe('every sentence with a citation marker is audited', () => {
  // The nine cited sentences the old research-meta regex dropped from the audit in the SP2 evidence (rounds 1 and 2).
  const skipped = JSON.parse(fixture('sp2-skipped-cited-sentences.json')) as Array<{ run: string; file: string; sentence: string }>

  it('has the nine real sentences', () => {
    expect(skipped).toHaveLength(9)
    expect(skipped.some(item => item.sentence.startsWith('The record-setting galaxy claim depends on a single source [4], and the model-revision'))).toBe(true)
  })

  it.each(skipped.map(item => [`${item.file}: ${item.sentence.slice(0, 60)}`, item.sentence]))('extracts it as a claim: %s', (_name, sentence) => {
    const claims = extractClaims(`A plain fact is stated here [1].\n\n${sentence}`)
    expect(claims.map(claim => claim.text)).toEqual(['A plain fact is stated here [1].', sentence.trim()])
    expect(claims[1]?.cites.length).toBeGreaterThan(0)
  })

  it('extracts research-meta sentences with a marker in running text; a sentence without a marker is not a claim', () => {
    const body = 'The wall is long [1]. The research rests on a single source [1]. One source [4] names no climber. Independent corroboration would help [2]. Nothing here is cited.'
    expect(extractClaims(body).map(claim => claim.text)).toEqual(['The wall is long [1].', 'The research rests on a single source [1].', 'One source [4] names no climber.', 'Independent corroboration would help [2].'])
  })

  it('exports no research-meta phrase test', () => {
    expect('isAboutResearch' in audit).toBe(false)
  })
})

describe('numbersIn and namesIn', () => {
  it('treats 5:12 and 05:12 as one time, and 05 as 5, and 6.50 as 6.5', () => {
    expect(numbersIn('At 05:12 and again at 5:12:30.')).toEqual(['5:12', '5:12:30'])
    expect(numbersIn('On 05 May the span was 6.50 and 8.0 metres.')).toEqual(['5', '6.5', '8'])
    const source: Source = { n: 1, title: 'T', site: 'Wikipedia', url: '', snippet: 'The call came at 5:12 on 05 May.' }
    expect(preCheck('The call came at 05:12 on 5 May [1].', [1], [source]).missingNumbers).toEqual([])
  })

  it('compares numbers without thousands commas', () => {
    expect(numbersIn('about 1,200 stars and 6.5 metres in 2021.')).toEqual(['1200', '6.5', '2021'])
  })

  it('finds name runs and acronyms but not a lone capital at the start', () => {
    expect(namesIn('The mirror of the James Webb Space Telescope (JWST) sees Hubble targets.')).toEqual(['James Webb Space Telescope', 'JWST', 'Hubble'])
    expect(namesIn('Researchers found it')).toEqual([])
  })
})

describe('preCheck', () => {
  it('passes a sentence whose words, numbers and names are all in the source', () => {
    const pre = preCheck('The James Webb Space Telescope launched on 25 December 2021 [1].', [1], SOURCES)
    expect(pre).toMatchObject({ best: 1, missingNumbers: [], missingNames: [], level: 'ok' })
    expect(pre.overlap).toBeGreaterThanOrEqual(0.5)
  })

  it('flags a number the source does not contain', () => {
    const pre = preCheck('The James Webb Space Telescope launched on 25 December 2022 [1].', [1], SOURCES)
    expect(pre.missingNumbers).toEqual(['2022'])
    expect(pre.level).toBe('weak')
  })

  it('accepts a name when any of its words is in the source, and a month written out when the source abbreviates it', () => {
    const source: Source = { n: 1, title: 'Deaths', site: 'Wikipedia', url: '', snippet: 'It occurred in the Ukrainian Soviet Socialist Republic. Posted Dec 2022 on the site.' }
    const pre = preCheck('It occurred in the Ukrainian SSR in December 2022 [1].', [1], [source])
    expect(pre.missingNames).toEqual([])
    expect(namesIn('Posted in December and on Friday')).toEqual([])
  })

  it('counts an acronym as present when the cited source spells it out in capitalised words (the captured r2 claim)', () => {
    const hn: Source = {
      n: 4,
      title: 'James Webb Space Telescope Finds Most Distant Known Galaxy',
      site: 'Hacker News',
      url: '',
      snippet: 'Hacker News story "James Webb Space Telescope Finds Most Distant Known Galaxy", linking to blogs.nasa.gov. 148 points, 55 comments, May 2024.',
      note: '148 points, 55 comments, May 2024',
    }
    const text = 'One post reports JWST identifying the most distant known galaxy, dated May 2024 [4].'
    const pre = preCheck(text, [4], [hn])
    expect(pre.missingNames).toEqual([])
    const draft = { id: 1, block: 0, piece: 0, text, cites: [4] }
    const claim = settleClaim(draft, pre, [hn], { id: 1, verdict: 'supported', spans: [{ source: 4, text: 'James Webb Space Telescope Finds Most Distant Known Galaxy' }], reason: 'Headline states it.' })
    expect(claim.verdict).toBe('supported')
  })

  it('still flags an acronym the source neither contains nor spells out, and does not read one out of lower-case words', () => {
    const source: Source = { n: 1, title: 'Space', site: 'Wikipedia', url: '', snippet: 'A space telescope that studies infrared light, used to see far.' }
    expect(preCheck('The telescope is run by NASA and the ESA [1].', [1], [source]).missingNames).toEqual(['NASA', 'ESA'])
    // "used to see far" is not a capitalised expansion of UTSF-style names; "a space telescope" does not spell AST.
    expect(preCheck('The AST data is used [1].', [1], [source]).missingNames).toEqual(['AST'])
  })

  it('flags a name the source does not contain', () => {
    const pre = preCheck('The telescope was built by Northrop Grumman with infrared astronomy goals [1].', [1], SOURCES)
    expect(pre.missingNames).toEqual(['Northrop Grumman'])
    expect(pre.level).toBe('weak')
  })

  it('fails a sentence that shares almost nothing with the source', () => {
    const pre = preCheck('Bananas contain potassium and grow in tropical regions [1].', [1], SOURCES)
    expect(pre.level).toBe('fail')
    expect(pre.overlap).toBe(0)
  })

  it('reads the note of a Hacker News source as source text', () => {
    expect(preCheck('The story had 764 points on Hacker News [2].', [2], SOURCES).missingNumbers).toEqual([])
  })

  it('fails a sentence that cites no source in the list', () => {
    const pre = preCheck('Webb saw galaxies [7].', [7], SOURCES)
    expect(pre).toMatchObject({ best: null, level: 'fail' })
    expect(decidedWithoutModel({ id: 1, block: 0, piece: 0, text: 'Webb saw galaxies [7].', cites: [7] }, pre)).toBe('It cites a source that is not in the list.')
  })

  it('picks the cited source with the most shared words as the best one', () => {
    expect(preCheck('Webb telescope finds early galaxies [1, 2].', [1, 2], SOURCES).best).toBe(2)
  })
})


/** The real SP2 round 2 (r2-1) and round 1 (r1-1) reports and the source text the app received, saved from the acceptance run. */
const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const R2_SOURCES = JSON.parse(fixture('sp2-r2-1-sources.json')) as Source[]
const R1_SOURCES = JSON.parse(fixture('sp2-r1-1-sources.json')) as Source[]
const R2_CLAIMS = extractClaims(reportBody(fixture('sp2-r2-1-report.md')))
const R1_CLAIMS = extractClaims(reportBody(fixture('sp2-r1-1-report.md')))
const settleFor = (claims: ReturnType<typeof extractClaims>, sources: Source[], id: number, judgment: Omit<Judgment, 'id'>) => {
  const draft = claims.find(claim => claim.id === id)
  if (!draft) throw new Error(`no claim ${id}`)
  return settleClaim(draft, preCheck(draft.text, draft.cites, sources), sources, { id, ...judgment })
}

describe('findSpan', () => {
  const text = 'Its 6.5 meter primary mirror lets it see objects too old and distant for Hubble.'

  it('finds the span despite spacing and curly quotes, and returns its place in the original text', () => {
    const span = findSpan(text, 'Its 6.5  meter\nprimary mirror')
    expect(text.slice(span?.start, span?.end)).toBe('Its 6.5 meter primary mirror')
    expect(findSpan('He said “it works well” today.', 'said "it works well"')).not.toBeNull()
  })

  it('is exact otherwise: case, wording and dashes must match', () => {
    expect(findSpan(text, 'ITS 6.5 meter primary mirror')).toBeNull()
    expect(findSpan(text, 'a 9 meter primary mirror lets it see')).toBeNull()
    expect(findSpan('A well-known, long-lived result here.', 'well–known, long-lived result')).toBeNull()
  })

  it('ignores an ellipsis the model put at either end, and refuses a span too short to mean anything', () => {
    const span = findSpan(text, 'objects too old and distant…')
    expect(text.slice(span?.start, span?.end)).toBe('objects too old and distant')
    expect(findSpan(text, 'primary mirror')).toBeNull()
    expect(findSpan(text, 'the')).toBeNull()
  })
})

describe('settleClaim: the typed verdict plus the verbatim span check, nothing else', () => {
  it('keeps supported for r2 claim 2 ("record-distant galaxy") when the span is in the source: no superlative table', () => {
    const claim = settleFor(R2_CLAIMS, R2_SOURCES, 2, {
      verdict: 'supported',
      spans: [{ source: 4, text: 'James Webb Space Telescope Finds Most Distant Known Galaxy' }],
      reason: 'Headline states the most distant known galaxy.',
    })
    expect(R2_CLAIMS[1]?.text).toContain('record-distant galaxy')
    expect(claim.verdict).toBe('supported')
    expect(claim.quotes).toHaveLength(1)
    expect(claim.quotes?.[0]).toMatchObject({ n: 4, text: 'James Webb Space Telescope Finds Most Distant Known Galaxy' })
    expect(R2_SOURCES[3]?.snippet.slice(claim.quotes?.[0]?.start, claim.quotes?.[0]?.end)).toBe('James Webb Space Telescope Finds Most Distant Known Galaxy')
  })

  it('keeps supported for r2 claim 3 even when the model says "implied, not stated": the reason text never changes the verdict', () => {
    const claim = settleFor(R2_CLAIMS, R2_SOURCES, 3, {
      verdict: 'supported',
      spans: [{ source: 5, text: 'The James Webb Space Telescope is finding too many early galaxies' }],
      uncovered: "the word 'expected'",
      reason: "'expected' wording is implied, not stated",
    })
    expect(R2_CLAIMS[2]?.text).toContain('more early galaxies than expected')
    expect(claim.verdict).toBe('supported')
    expect(claim.reason).toBe("'expected' wording is implied, not stated")
  })

  it('makes a supported verdict whose span is not in the source "unverified" (r2 claim 2 and 3)', () => {
    const c2 = settleFor(R2_CLAIMS, R2_SOURCES, 2, { verdict: 'supported', spans: [{ source: 4, text: 'JWST found the record-distant galaxy of May 2024' }], reason: 'Stated.' })
    expect(c2.verdict).toBe('unverified')
    expect(c2.quotes ?? []).toEqual([])
    expect(c2.reason).toContain('not found in the source')
    const c3 = settleFor(R2_CLAIMS, R2_SOURCES, 3, { verdict: 'supported', spans: [{ source: 5, text: 'JWST is finding more early galaxies than expected' }], reason: 'Stated.' })
    expect(c3.verdict).toBe('unverified')
  })

  it('makes a supported verdict with one verbatim span and one invented span "unverified", and one with no span too', () => {
    const real = { source: 4, text: 'James Webb Space Telescope Finds Most Distant Known Galaxy' }
    expect(settleFor(R2_CLAIMS, R2_SOURCES, 2, { verdict: 'supported', spans: [real, { source: 4, text: 'a span the source never contains' }] }).verdict).toBe('unverified')
    expect(settleFor(R2_CLAIMS, R2_SOURCES, 2, { verdict: 'supported', spans: [] }).verdict).toBe('unverified')
  })

  it('accepts a span only from a source the claim cites', () => {
    const wrong = settleFor(R2_CLAIMS, R2_SOURCES, 2, { verdict: 'supported', spans: [{ source: 5, text: 'The James Webb Space Telescope is finding too many early galaxies' }] })
    expect(wrong.verdict).toBe('unverified')
  })

  it('finds a span whose source number the model got wrong, when another cited source holds it', () => {
    const claim = settleFor(R2_CLAIMS, R2_SOURCES, 2, { verdict: 'supported', spans: [{ source: 1, text: 'James Webb Space Telescope Finds Most Distant Known Galaxy' }] })
    expect(claim.verdict).toBe('supported')
    expect(claim.quotes?.[0]?.n).toBe(4)
  })

  it('keeps partly for r1 claim 2 and shows the part of the claim the source does not cover', () => {
    const claim = settleFor(R1_CLAIMS, R1_SOURCES, 2, {
      verdict: 'partly',
      spans: [{ source: 3, text: R1_SOURCES[2]?.snippet.slice(0, 60) ?? '' }],
      uncovered: 'that these scissors are Cas9 specifically',
      reason: 'Source describes genome editors in general.',
    })
    expect(claim.verdict).toBe('partly')
    expect(claim.uncovered).toBe('that these scissors are Cas9 specifically')
    expect(claim.quotes).toHaveLength(1)
  })

  it('never turns a model "unsupported" into something better, and ignores spans it gave', () => {
    const claim = settleFor(R2_CLAIMS, R2_SOURCES, 2, { verdict: 'unsupported', spans: [{ source: 4, text: 'James Webb Space Telescope Finds Most Distant Known Galaxy' }], reason: 'Not stated.' })
    expect(claim.verdict).toBe('unsupported')
    expect(claim.quotes ?? []).toEqual([])
  })

  it('marks a sentence with no judgment as not checked', () => {
    const draft = R2_CLAIMS[0]
    if (!draft) throw new Error('no claim')
    expect(settleClaim(draft, preCheck(draft.text, draft.cites, R2_SOURCES), R2_SOURCES, undefined)).toMatchObject({ verdict: 'unchecked' })
  })
})

describe('no prose or word-list rule is left in the verdict', () => {
  const good = [{ source: 4, text: 'James Webb Space Telescope Finds Most Distant Known Galaxy' }]
  const reasons = [
    'it does not say this is a recurring theme across accounts generally',
    'The source does not mention the cause.',
    'Source extrapolates beyond the series.',
    "'expected' wording is implied, not stated",
    'A mild extension of the source; the claim goes beyond the source.',
    'Not all of the claim is stated.',
    'Date stated.',
  ]

  it.each(reasons)('a supported verdict with verbatim spans stays supported whatever the reason says: %s', reason => {
    expect(settleFor(R2_CLAIMS, R2_SOURCES, 2, { verdict: 'supported', spans: good, reason, uncovered: reason }).verdict).toBe('supported')
  })

  it.each([
    ['highest, first, only and record words the source never uses', 'It is the highest, the first and the only record telescope ever built [1].'],
    ['a number and a name the source never mentions', 'Dr Zorblax measured 4,242 galaxies on 3 March 1999 [1].'],
  ])('the claim text never changes the verdict: %s', (_name, text) => {
    const source: Source = R2_SOURCES[0] as Source
    const draft = { id: 1, block: 0, piece: 0, text, cites: [1] }
    const span = { source: 1, text: 'designed to conduct infrared astronomy' }
    expect(settleClaim(draft, preCheck(text, [1], [source]), [source], { id: 1, verdict: 'supported', spans: [span] }).verdict).toBe('supported')
    expect(settleClaim(draft, preCheck(text, [1], [source]), [source], { id: 1, verdict: 'partly', spans: [span] }).verdict).toBe('partly')
    expect(settleClaim(draft, preCheck(text, [1], [source]), [source], { id: 1, verdict: 'unsupported' }).verdict).toBe('unsupported')
  })

  it('exports no reason-reading or superlative-table function, and its source holds none', () => {
    expect('admitsGap' in audit).toBe(false)
    expect('unstatedSuperlatives' in audit).toBe(false)
    const code = readFileSync(new URL('../../src/lib/audit.ts', import.meta.url), 'utf8')
    for (const name of ['admitsGap', 'SUPERLATIVES', 'unstatedSuperlatives', 'conflict']) expect(code).not.toContain(name)
  })

  it('lets the model judge a sentence that shares no content word with its source; code only refuses a source that is not in the list', () => {
    const draft = { id: 1, block: 0, piece: 0, text: 'Bananas are rich in potassium [1].', cites: [1] }
    expect(decidedWithoutModel(draft, preCheck(draft.text, [1], SOURCES))).toBeNull()
    const missing = { ...draft, text: 'Bananas are rich in potassium [9].', cites: [9] }
    expect(decidedWithoutModel(missing, preCheck(missing.text, [9], SOURCES))).toBe('It cites a source that is not in the list.')
  })
})

describe('the preceding sentence as context', () => {
  it('gives r1 claim 2 ("These programmable ...") the Cas9 sentence before it, so "These" can be resolved', () => {
    const claim = R1_CLAIMS.find(candidate => candidate.id === 2)
    expect(claim?.text).toMatch(/^These programmable/)
    expect(claim?.context).toBe('The Cas9 nuclease paired with a synthetic guide RNA can cut the genome at a chosen location when delivered into a cell.')
  })

  it('takes the last sentence of the previous text block when the claim opens its block, and none for the first sentence of the report', () => {
    const claims = extractClaims('First fact is here [1].\n\nSecond block opens here [2]. Then more [3].')
    expect(claims[0]?.context).toBeUndefined()
    expect(claims[1]?.context).toBe('First fact is here.')
    expect(claims[2]?.context).toBe('Second block opens here.')
  })

  it('does not take a heading as context', () => {
    const claims = extractClaims('Intro sentence here.\n\n## A Heading\n\nA fact after it [1].')
    expect(claims[0]?.context).toBe('Intro sentence here.')
  })
})

describe('names in plural form', () => {
  it('accepts "Suns" when the source says "the Sun"', () => {
    const source: Source = { n: 2, title: 'Black hole', site: 'Wikipedia', url: '', snippet: 'Masses of millions to billions of times the mass of the Sun. Almost every large galaxy has one at its center.' }
    expect(preCheck('Black holes have masses of millions to billions of Suns, at the centers of large galaxies [2].', [2], [source]).missingNames).toEqual([])
  })
})

describe('hyphenated names', () => {
  it('treats Polish-born as its parts', () => {
    const source: Source = { n: 1, title: 'Marie Curie', site: 'Wikipedia', url: '', snippet: 'Marie Curie was a Polish and naturalised-French physicist.' }
    expect(preCheck('Marie Curie was a Polish-born physicist [1].', [1], [source]).missingNames).toEqual([])
  })
})


describe('summary', () => {
  const claim = (id: number, verdict: AuditClaim['verdict']): AuditClaim => ({
    id,
    block: 0,
    piece: id,
    text: '',
    cites: [1],
    pre: { overlap: 1, best: 1, missingNumbers: [], missingNames: [], level: 'ok' },
    verdict,
    reason: '',
  })

  it('counts every verdict, shows unverified as its own count, and words the headline', () => {
    const summary = summarize([claim(1, 'supported'), claim(2, 'supported'), claim(3, 'partly'), claim(4, 'unsupported'), claim(5, 'unchecked'), claim(6, 'unverified')])
    expect(summary).toEqual({ total: 6, supported: 2, partly: 1, unsupported: 1, unchecked: 1, unverified: 1 })
    expect(summaryLine(summary)).toBe('2 of 6 cited claims supported')
    expect(summaryDetail(summary)).toBe('1 partly supported, 1 not supported, 1 unverified, 1 not checked')
  })

  it('handles one claim and none', () => {
    expect(summaryLine(summarize([claim(1, 'supported')]))).toBe('1 of 1 cited claim supported')
    expect(summaryLine(summarize([]))).toBe('No cited claims to check')
  })
})
