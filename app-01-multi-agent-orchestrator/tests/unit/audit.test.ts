import { describe, expect, it } from 'vitest'
import {
  citesOf,
  decidedWithoutModel,
  extractClaims,
  admitsGap,
  reversedPair,
  unstatedSuperlatives,
  isAboutResearch,
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

describe('claims about the research itself', () => {
  it('are not extracted as claims, and the sentence stays plain in the report', () => {
    const body = 'The wall is long [1]. The research rests on a single source [1]. One source [4] names no climber. Independent corroboration would help [2].'
    expect(extractClaims(body).map(claim => claim.text)).toEqual(['The wall is long [1].'])
    expect(isAboutResearch('No source names the climbers [3].')).toBe(false)
    expect(isAboutResearch('The sources do not agree [3].')).toBe(true)
    expect(isAboutResearch('The sources consulted mention these but offer no detail on what causal evidence supports them [3][4].')).toBe(true)
    expect(isAboutResearch('Python 3.0 was released as a major version, but the sources cut off before giving its release date [1].')).toBe(true)
    expect(isAboutResearch('Popular "unsinkable" claims about the ship are treated in the sources as legends rather than established facts [3].')).toBe(false)
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

describe('a supported verdict that the reason contradicts', () => {
  const documentary =
    'Titanic Sinks Tonight is a four-part television documentary and drama series about the sinking of the Titanic. The series places emphasis on the social class and sex of the passengers, as well as the perceived mistakes by those in command.'
  const sources: Source[] = [{ n: 2, title: 'Titanic Sinks Tonight', site: 'Wikipedia', url: 'https://x.test', snippet: documentary }]
  const quote = 'The series places emphasis on the social class and sex of the passengers, as well as the perceived mistakes by those in command.'
  const settle = (text: string, reason: string) => {
    const draft = { id: 1, block: 0, piece: 0, text, cites: [2] }
    return settleClaim(draft, preCheck(text, [2], sources), sources, { id: 1, verdict: 'supported', source: 2, quote, reason })
  }

  it('caps the widened documentary claim to partly and keeps the reason', () => {
    const claim = settle('Accounts of the disaster frequently point to perceived mistakes by those in command as a recurring theme [2].', "Source says the series emphasizes perceived mistakes by those in command; 'recurring theme' is a mild extension.")
    expect(claim.verdict).toBe('partly')
    expect(claim.reason).toContain('mild extension')
    expect(claim.reason).toContain('does not state all of the claim')
  })

  it('caps the "implied" case from the 1906 earthquake report', () => {
    const claim = settle('The quake itself caused severe damage, but fires that burned for several days compounded it [2].', 'Source states fires lasted several days after the earthquake; damage attribution is implied.')
    expect(claim.verdict).toBe('partly')
  })

  it.each([
    'it does not say this is a recurring theme across accounts generally',
    "it describes a documentary, not all accounts, so close paraphrase",
    'The source does not mention the cause.',
    'Source extrapolates beyond the series.',
    'The source does not explicitly state this.',
    'Cause not mentioned in the source.',
  ])('flags the reason: %s', reason => {
    expect(admitsGap(reason)).toBe(true)
  })

  it.each([
    'Source states the date, which does not differ from the claim.',
    'Source states magnitude, coast, time, and date as claimed.',
    'Source states both the death toll above 3,000 and over 80% destruction.',
    'The source does not say otherwise; wording matches.',
    'Shaking extends from Eureka to the Salinas Valley, as stated.',
    'Date stated.',
  ])('leaves a true supported reason alone: %s', reason => {
    expect(admitsGap(reason)).toBe(false)
    expect(settle('The series emphasizes perceived mistakes by those in command [2].', reason).verdict).toBe('supported')
  })
})

describe('superlatives the source does not state', () => {
  const quake: Source = {
    n: 1, title: 'San Francisco earthquake', site: 'Wikipedia', url: 'https://x.test',
    snippet: 'With a maximum Mercalli intensity of XI (Extreme), it created high-intensity shaking from Eureka on the North Coast to the Salinas Valley.',
  }
  const text = 'The shaking reached the highest category on the Mercalli intensity scale, XI (Extreme), and was strong along a long stretch of coast from Eureka to the Salinas Valley [1].'

  it('caps the Mercalli claim to partly and names the word', () => {
    const draft = { id: 1, block: 0, piece: 0, text, cites: [1] }
    const claim = settleClaim(draft, preCheck(text, [1], [quake]), [quake], {
      id: 1, verdict: 'supported', source: 1, quote: 'With a maximum Mercalli intensity of XI (Extreme), it created high-intensity shaking from Eureka on the North Coast to the Salinas Valley.',
      reason: 'Intensity XI and the Eureka to Salinas Valley range are both stated.',
    })
    expect(claim.verdict).toBe('partly')
    expect(claim.reason).toContain('The source text does not state "highest".')
  })

  it('counts a word only where it ranks, and accepts synonyms', () => {
    const src = (snippet: string): Source[] => [{ ...quake, snippet }]
    for (const claim of ['Fires not only broke out but also lasted days [1].', 'At first the tower was red [1].', 'Named for him ever since [1].', 'Most of the city was destroyed [1].', 'It was most likely a fire [1].', 'She was designed first and then built [1].'])
      expect(unstatedSuperlatives(claim, src('Fires lasted days.'))).toEqual([])
    expect(unstatedSuperlatives('It is the tallest structure [1].', src('It is the highest structure.'))).toEqual([])
    expect(unstatedSuperlatives('It was her first voyage, the first of three [1].', src('A voyage.'))).toEqual(['first'])
    expect(unstatedSuperlatives('It is the only one [1].', src('It is exclusively theirs.'))).toEqual([])
    expect(unstatedSuperlatives('The most damaged city [1].', src('Over 80% of the city was destroyed.'))).toEqual([])
    expect(unstatedSuperlatives('The most damaged city [1].', src('Over 30% of the city was destroyed.'))).toEqual(['most'])
    expect(unstatedSuperlatives('The largest storm ever recorded [1].', src('A storm.'))).toEqual(['largest', 'ever'])
  })

  it('finds the word, or a synonym, in the cited source', () => {
    const src = (snippet: string): Source[] => [{ ...quake, snippet }]
    expect(unstatedSuperlatives(text, src('XI was the highest category reached.'))).toEqual([])
    expect(unstatedSuperlatives('It was the first described in 1906 [1].', src('It was first described in 1906.'))).toEqual([])
    expect(unstatedSuperlatives('Almost every galaxy has one [1].', src('Every galaxy has one.'))).toEqual([])
    expect(unstatedSuperlatives('It was the largest city [1].', src('It was the biggest city.'))).toEqual([])
    expect(unstatedSuperlatives('It is the only survivor, and the most notable [1].', src('A survivor.'))).toEqual(['only', 'most'])
  })
})

describe('a verdict is never raised in code', () => {
  const source: Source = { n: 1, title: 'Titanic', site: 'Wikipedia', url: '', snippet: 'RMS Titanic struck an iceberg at 23:40 and sank two hours later. She was the largest ship afloat.' }
  it.each([
    ['The Titanic struck a mine and sank [1].', 'Source 1 says Titanic struck an iceberg, not a mine.'],
    ['The fault is left-lateral [1].', 'Source describes a right-lateral fault, but the claim says left-lateral.'],
    ['She did not strike an iceberg [1].', 'Source states she struck an iceberg.'],
    ['Gas mains started the fires on the ship [1].', 'Source says nothing about gas mains starting the fires.'],
    ['The ship was built by the company of Thomas Edison [1].', 'Source states the company of Gustave Eiffel designed and built it.'],
    ['The ship sank slowly over three days [1].', 'Source says the reverse: she sank two hours later.'],
    ['The ship hit a mine and an iceberg [1].', 'Source 1 states she hit an iceberg; no mine is mentioned.'],
  ])('keeps unsupported: %s', (text, reason) => {
    const draft = { id: 1, block: 0, piece: 0, text, cites: [1] }
    expect(settleClaim(draft, preCheck(text, [1], [source]), [source], { id: 1, verdict: 'unsupported', reason })).toMatchObject({ verdict: 'unsupported', reason })
  })
})

describe('names in plural form', () => {
  it('accepts "Suns" when the source says "the Sun"', () => {
    const source: Source = { n: 2, title: 'Black hole', site: 'Wikipedia', url: '', snippet: 'Masses of millions to billions of times the mass of the Sun. Almost every large galaxy has one at its center.' }
    expect(preCheck('Black holes have masses of millions to billions of Suns, at the centers of large galaxies [2].', [2], [source]).missingNames).toEqual([])
  })
})

describe('a supported verdict the sources reverse', () => {
  const eiffel: Source = { n: 3, title: 'Eiffel Tower', site: 'Wikipedia', url: '', snippet: 'It was the tallest man-made structure in the world until the Chrysler Building in New York City was finished in 1930.' }
  const quote = 'It was the tallest man-made structure in the world until the Chrysler Building in New York City was finished in 1930.'
  const settle = (text: string, reason: string) =>
    settleClaim({ id: 1, block: 0, piece: 0, text, cites: [3] }, preCheck(text, [3], [eiffel]), [eiffel], { id: 1, verdict: 'supported', source: 3, quote, reason })

  it('lowers the reversed Eiffel claim to unsupported and names both words', () => {
    const claim = settle('The Eiffel Tower became the tallest man-made structure in the world after the Chrysler Building was finished [3].', 'Source says the tower was tallest until the Chrysler Building.')
    expect(claim.verdict).toBe('unsupported')
    expect(claim.reason).toContain('The claim says "after" where the source says "until".')
    expect(claim.quote).toBeUndefined()
  })

  it('keeps the consistent claim supported', () => {
    expect(settle('The Eiffel Tower was the tallest man-made structure in the world until the Chrysler Building was finished [3].', 'Source states it.').verdict).toBe('supported')
  })

  it.each([
    ['It closed after the war ended', 'It closed after the war ended in 1945.'],
    ['Work began before the winter storms', 'Work began before the winter storms hit.'],
    ['It lies north of Paris', 'The town lies north of Paris.'],
    ['Sales rose to 5 million', 'Sales rose to 5 million units.'],
    ['It was built after 1887 and before 1889', 'Built after 1887, finished before 1889.'],
    ['The fire caused the collapse', 'The collapse was caused by the fire.'],
  ])('leaves a consistent sentence alone: %s', (claim, evidence) => {
    expect(reversedPair(claim, evidence)).toBeNull()
  })

  it.each([
    ['Sales rose to 5 million', 'Sales fell to 5 million units.'],
    ['The town lies north of Paris', 'The town lies south of Paris.'],
    ['The fire caused the collapse', 'The fire was caused by the collapse.'],
  ])('catches a reversal: %s', (claim, evidence) => {
    expect(reversedPair(claim, evidence)).not.toBeNull()
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
