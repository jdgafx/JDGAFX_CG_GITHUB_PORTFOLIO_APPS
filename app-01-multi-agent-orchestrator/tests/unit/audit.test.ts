import { describe, expect, it } from 'vitest'
import {
  citesOf,
  decidedWithoutModel,
  extractClaims,
  findQuote,
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

describe('numbersIn and namesIn', () => {
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

describe('findQuote', () => {
  const text = 'Its 6.5 meter primary mirror lets it see objects too old and distant for Hubble.'

  it('finds the span despite case, spacing and curly quotes', () => {
    const span = findQuote(text, 'ITS 6.5  meter primary mirror')
    expect(span).not.toBeNull()
    expect(text.slice(span?.start, span?.end)).toBe('Its 6.5 meter primary mirror')
    expect(findQuote('He said “it works well” today.', 'said "it works well"')).not.toBeNull()
  })

  it('ignores a trailing ellipsis the model added', () => {
    const span = findQuote(text, 'objects too old and distant…')
    expect(text.slice(span?.start, span?.end)).toBe('objects too old and distant')
  })

  it('refuses a quote that is not in the text, or too short to mean anything', () => {
    expect(findQuote(text, 'a 9 meter primary mirror lets it see')).toBeNull()
    expect(findQuote(text, 'primary mirror')).toBeNull()
    expect(findQuote(text, 'the')).toBeNull()
  })
})

describe('settleClaim', () => {
  const draft = { id: 1, block: 0, piece: 0, text: 'The James Webb Space Telescope launched on 25 December 2021 [1].', cites: [1] }
  const pre = preCheck(draft.text, draft.cites, SOURCES)

  it('keeps supported when the quote is word for word in the cited source', () => {
    const claim = settleClaim(draft, pre, SOURCES, { id: 1, verdict: 'supported', source: 1, quote: 'It launched on 25 December 2021.', reason: 'Date stated.' })
    expect(claim.verdict).toBe('supported')
    expect(claim.quote).toMatchObject({ n: 1, text: 'It launched on 25 December 2021.' })
    expect(JWST.slice(claim.quote?.start, claim.quote?.end)).toBe('It launched on 25 December 2021.')
  })

  it('downgrades supported to partly when the quote is not in the source, and drops the quote', () => {
    const claim = settleClaim(draft, pre, SOURCES, { id: 1, verdict: 'supported', source: 1, quote: 'It lifted off on Christmas Day 2021.', reason: 'Date.' })
    expect(claim.verdict).toBe('partly')
    expect(claim.quote).toBeUndefined()
    expect(claim.reason).toContain('not in the source text')
  })

  it('downgrades supported to partly when a number is in no cited source', () => {
    const wrong = { ...draft, text: 'The James Webb Space Telescope launched on 25 December 2022 [1].' }
    const claim = settleClaim(wrong, preCheck(wrong.text, wrong.cites, SOURCES), SOURCES, {
      id: 1,
      verdict: 'supported',
      source: 1,
      quote: 'It launched on 25 December 2021.',
    })
    expect(claim.verdict).toBe('partly')
    expect(claim.reason).toContain('2022')
    expect(claim.quote).toBeDefined()
  })

  it('never turns a model "unsupported" into something better, and ignores a quote it gave', () => {
    const claim = settleClaim(draft, pre, SOURCES, { id: 1, verdict: 'unsupported', quote: 'It launched on 25 December 2021.', reason: 'Not stated.' })
    expect(claim.verdict).toBe('unsupported')
    expect(claim.quote).toBeUndefined()
  })

  it('only accepts a quote from a source the claim cites', () => {
    const claim = settleClaim(draft, pre, SOURCES, { id: 1, verdict: 'partly', source: 2, quote: 'Webb telescope finds early galaxies' })
    expect(claim.quote).toBeUndefined()
  })

  it('marks a sentence with no judgment as not checked', () => {
    expect(settleClaim(draft, pre, SOURCES, undefined)).toMatchObject({ verdict: 'unchecked' })
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

  it('counts every verdict and words the headline', () => {
    const summary = summarize([claim(1, 'supported'), claim(2, 'supported'), claim(3, 'partly'), claim(4, 'unsupported'), claim(5, 'unchecked')])
    expect(summary).toEqual({ total: 5, supported: 2, partly: 1, unsupported: 1, unchecked: 1 })
    expect(summaryLine(summary)).toBe('2 of 5 cited claims supported')
    expect(summaryDetail(summary)).toBe('1 partly supported, 1 not supported, 1 not checked')
  })

  it('handles one claim and none', () => {
    expect(summaryLine(summarize([claim(1, 'supported')]))).toBe('1 of 1 cited claim supported')
    expect(summaryLine(summarize([]))).toBe('No cited claims to check')
  })
})
