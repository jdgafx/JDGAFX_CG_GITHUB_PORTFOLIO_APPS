import { describe, expect, it } from 'vitest'
import * as audit from '../../src/lib/audit'
import {
  citesOf,
  decidedWithoutModel,
  settleClaim,
  extractClaims,
  namesIn,
  numbersIn,
  preCheck,
  reportBody,
  sentencePieces,
  summarize,
  summaryDetail,
  summaryLine,
} from '../../src/lib/audit'
import type { AuditClaim, Source } from '../../src/types'
import { fixture } from '../fixtures/load'

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
    const claim = settleClaim(draft, pre, [hn], { id: 1, sourceSupports: 'yes', subjectMatches: 'yes', causeMatches: 'not_applicable', allPartsCovered: 'yes', spans: [{ source: 4, text: 'James Webb Space Telescope Finds Most Distant Known Galaxy' }], reason: 'Headline states it.' })
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
    const summary = summarize([claim(1, 'supported'), claim(2, 'supported'), claim(3, 'partly'), claim(4, 'unsupported'), claim(5, 'unchecked'), claim(6, 'unverified'), claim(7, 'research')])
    expect(summary).toEqual({ total: 7, supported: 2, partly: 1, unsupported: 1, unchecked: 1, unverified: 1, research: 1 })
    expect(summaryLine(summary)).toBe('2 of 7 cited claims supported')
    expect(summaryDetail(summary)).toBe('1 partly supported, 1 not supported, 1 unverified, 1 about the research, 1 not checked')
  })

  it('handles one claim and none', () => {
    expect(summaryLine(summarize([claim(1, 'supported')]))).toBe('1 of 1 cited claim supported')
    expect(summaryLine(summarize([]))).toBe('No cited claims to check')
  })
})
