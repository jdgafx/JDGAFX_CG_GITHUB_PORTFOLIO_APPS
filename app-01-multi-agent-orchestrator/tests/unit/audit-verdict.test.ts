import { describe, expect, it } from 'vitest'
import * as audit from '../../src/lib/audit'
import { decidedWithoutModel, deriveVerdict, extractClaims, findSpan, preCheck, reportBody, settleClaim, type Judgment } from '../../src/lib/audit'
import type { Source } from '../../src/types'
import { fixture } from '../fixtures/load'

const PASS = { sourceSupports: 'yes', subjectMatches: 'yes', causeMatches: 'not_applicable', allPartsCovered: 'yes' } as const

interface Handchecked {
  run: string
  id: number
  text: string
  hand: string
  roundThreeAudit: string
  criteria: { source_supports: 'yes' | 'no'; subject_matches: 'yes' | 'no'; cause_matches: 'yes' | 'no' | 'not_applicable'; all_parts_covered: 'yes' | 'no' }
  spans: Array<{ source: number; text: string }>
}
const HAND = JSON.parse(fixture('sp3-handchecked-claims.json')) as Handchecked[]
const SOURCES: Record<string, Source[]> = Object.fromEntries(['r1-1', 'r2-1', 'r3-1'].map(run => [run, JSON.parse(fixture(`sp3-${run}-sources.json`)) as Source[]]))
const CLAIMS = Object.fromEntries(['r1-1', 'r2-1', 'r3-1'].map(run => [run, extractClaims(reportBody(fixture(`sp3-${run}-report.md`)))]))

/** The round 3 claim whose text matches, settled with the typed criteria and the real spans the model returned. */
function settleHand(item: Handchecked, over: Partial<Judgment> = {}) {
  const draft = CLAIMS[item.run]?.find(claim => claim.text === item.text)
  if (!draft) throw new Error(`no claim "${item.text}" in ${item.run}`)
  const sources = SOURCES[item.run] ?? []
  return settleClaim(draft, preCheck(draft.text, draft.cites, sources), sources, {
    id: draft.id,
    sourceSupports: item.criteria.source_supports,
    subjectMatches: item.criteria.subject_matches,
    causeMatches: item.criteria.cause_matches,
    allPartsCovered: item.criteria.all_parts_covered,
    spans: item.spans,
    ...over,
  })
}

describe('deriveVerdict: a table of typed criteria and the span check', () => {
  const ok = { found: 1, missed: 0, joined: 0 }
  it.each([
    ['all criteria pass and every span is one found passage', PASS, ok, 'supported'],
    ['source_supports no (silent or incompatible)', { ...PASS, sourceSupports: 'no' }, ok, 'unsupported'],
    ['source_supports no beats every other field', { ...PASS, sourceSupports: 'no', subjectMatches: 'no' }, ok, 'unsupported'],
    ['subject_matches no', { ...PASS, subjectMatches: 'no' }, ok, 'partly'],
    ['cause_matches no', { ...PASS, causeMatches: 'no' }, ok, 'partly'],
    ['cause_matches yes counts as a pass', { ...PASS, causeMatches: 'yes' }, ok, 'supported'],
    ['all_parts_covered no', { ...PASS, allPartsCovered: 'no' }, ok, 'partly'],
    ['a criterion no with spans not found stays partly', { ...PASS, allPartsCovered: 'no' }, { found: 0, missed: 1, joined: 0 }, 'partly'],
    ['all pass, no span at all', PASS, { found: 0, missed: 0, joined: 0 }, 'unverified'],
    ['all pass, one span not found', PASS, { found: 1, missed: 1, joined: 0 }, 'unverified'],
    ['all pass, a span that joins two passages', PASS, { found: 1, missed: 0, joined: 1 }, 'unverified'],
  ] as const)('%s -> %s', (_name, criteria, spans, verdict) => {
    expect(deriveVerdict(criteria, spans)).toBe(verdict)
  })
})

describe('the nine hand-checked round 3 claims, from the real sources and the real spans the model returned', () => {
  it('has the nine claims, 7 where the round 3 audit agreed and 2 where it said supported against a hand "partly"', () => {
    expect(HAND).toHaveLength(9)
    expect(HAND.filter(item => item.roundThreeAudit !== item.hand).map(item => `${item.run}:${item.text.slice(0, 30)}`)).toEqual([
      'r1-1:Using these programmable molec',
      'r2-1:JWST is built for infrared ast',
    ])
  })

  it.each(HAND.map(item => [`${item.run} "${item.text.slice(0, 50)}" (hand ${item.hand})`, item] as const))('%s', (_name, item) => {
    const claim = settleHand(item)
    expect(claim.verdict).toBe(item.hand)
    if (item.hand === 'supported') expect((claim.quotes ?? []).length).toBe(item.spans.length)
  })

  it('r1 claim 3 ("these programmable molecules" = Cas9) is partly because subject_matches is no, with the same spans that made round 3 say supported', () => {
    const item = HAND.find(candidate => candidate.run === 'r1-1' && candidate.text.startsWith('Using these'))
    if (!item) throw new Error('missing')
    expect(settleHand(item, { subjectMatches: 'yes' }).verdict).toBe('supported')
    expect(settleHand(item).verdict).toBe('partly')
    expect(CLAIMS['r1-1']?.find(claim => claim.text === item.text)?.context).toMatch(/^The Cas9 nuclease is paired with a synthetic guide RNA/)
  })

  it('r2 claim 1 (infrared design as the cause) is partly because cause_matches is no, although its three passages are separate verbatim spans', () => {
    const item = HAND.find(candidate => candidate.run === 'r2-1' && candidate.text.startsWith('JWST is built'))
    if (!item) throw new Error('missing')
    expect(item.spans).toHaveLength(3)
    expect(settleHand(item, { causeMatches: 'yes' }).verdict).toBe('supported')
    expect(settleHand(item).verdict).toBe('partly')
    expect((settleHand(item).quotes ?? []).length).toBe(3)
  })
})

describe('settleClaim derives the verdict from criteria and spans only', () => {
  const item = HAND.find(candidate => candidate.run === 'r3-1' && candidate.hand === 'supported') as Handchecked

  it('makes a supported-looking claim with a span not in the source unverified', () => {
    expect(settleHand(item, { spans: [{ source: 1, text: 'a sentence that the source never contains' }] }).verdict).toBe('unverified')
  })

  it('counts a malformed span the model sent as a missed span', () => {
    expect(settleHand(item, { badSpans: 1 }).verdict).toBe('unverified')
    expect(settleHand(item, { badSpans: 0 }).verdict).toBe('supported')
  })

  it('shows what the source does not cover for partly and unsupported, and ignores spans for unsupported', () => {
    const partly = settleHand(item, { allPartsCovered: 'no', uncovered: 'the word "compiler"' })
    expect(partly).toMatchObject({ verdict: 'partly', uncovered: 'the word "compiler"' })
    const none = settleHand(item, { sourceSupports: 'no' })
    expect(none.verdict).toBe('unsupported')
    expect(none.quotes ?? []).toEqual([])
  })

  it('keeps only the found spans for partly, and drops them all when the claim is unverified', () => {
    const spans = [...item.spans, { source: 1, text: 'invented words that no source holds' }]
    expect((settleHand(item, { allPartsCovered: 'no', spans }).quotes ?? []).length).toBe(item.spans.length)
    expect(settleHand(item, { spans }).quotes).toBeUndefined()
  })

  it('reads no reason text: whatever the reason says, the verdict is the derived one', () => {
    for (const reason of ['it does not say this', 'implied, not stated', 'a mild extension', 'goes beyond the source', 'Date stated.'])
      expect(settleHand(item, { reason, uncovered: reason }).verdict).toBe('supported')
  })

  it('never lets the claim text change the verdict: superlatives, numbers and names the source lacks', () => {
    const source = SOURCES['r3-1']?.[0] as Source
    const text = 'Dr Zorblax measured the highest, first and only record of 4,242 crates on 3 March 1999 [1].'
    const draft = { id: 1, block: 0, piece: 0, text, cites: [1] }
    const span = { source: 1, text: source.snippet.slice(0, 40) }
    const j: Judgment = { id: 1, ...PASS, spans: [span] }
    expect(settleClaim(draft, preCheck(text, [1], [source]), [source], j).verdict).toBe('supported')
    expect(settleClaim(draft, preCheck(text, [1], [source]), [source], { ...j, allPartsCovered: 'no' }).verdict).toBe('partly')
  })

  it('marks a sentence with no judgment as not checked', () => {
    const draft = CLAIMS['r3-1']?.[0]
    if (!draft) throw new Error('no claim')
    expect(settleClaim(draft, preCheck(draft.text, draft.cites, SOURCES['r3-1'] ?? []), SOURCES['r3-1'] ?? [], undefined)).toMatchObject({ verdict: 'unchecked' })
  })

  it('exports no reason-reading or superlative-table function, and its source holds none', () => {
    for (const name of ['admitsGap', 'unstatedSuperlatives', 'isAboutResearch']) expect(name in audit).toBe(false)
    const code = fixture('../../src/lib/audit.ts')
    for (const name of ['admitsGap', 'SUPERLATIVES', 'unstatedSuperlatives', 'conflict', 'isAboutResearch']) expect(code).not.toContain(name)
  })

  it('lets the model judge a sentence that shares no content word with its source; code only refuses a source that is not in the list', () => {
    const draft = { id: 1, block: 0, piece: 0, text: 'Bananas are rich in potassium [1].', cites: [1] }
    const sources = SOURCES['r3-1'] ?? []
    expect(decidedWithoutModel(draft, preCheck(draft.text, [1], sources))).toBeNull()
    const missing = { ...draft, text: 'Bananas are rich in potassium [9].', cites: [9] }
    expect(decidedWithoutModel(missing, preCheck(missing.text, [9], sources))).toBe('It cites a source that is not in the list.')
  })
})

describe('findSpan', () => {
  const text = 'Its 6.5 meter primary mirror lets it see objects too old and distant for Hubble. It is 6.5 m wide - and light. A well–known result.'

  const at = (span: string) => findSpan(text, span)?.map(range => text.slice(range.start, range.end)) ?? null

  it('finds the span despite spacing, curly quotes, case and dash variants, and returns its place in the original text', () => {
    expect(at('Its 6.5  meter\nprimary mirror')).toEqual(['Its 6.5 meter primary mirror'])
    expect(at('ITS 6.5 METER PRIMARY MIRROR')).toEqual(['Its 6.5 meter primary mirror'])
    expect(at('a well-known result')).toEqual(['A well–known result'])
    expect(at('6.5 m wide — and light')).toEqual(['6.5 m wide - and light'])
    expect(findSpan('He said “it works well” today.', 'said "it works well"')).not.toBeNull()
  })

  it('accepts a short true span of three words, and refuses fewer', () => {
    expect(at('6.5 m wide')).toEqual(['6.5 m wide'])
    expect(at('primary mirror')).toBeNull()
    expect(at('the')).toBeNull()
  })

  it('refuses wording the source does not hold', () => {
    expect(at('a 9 meter primary mirror lets it see')).toBeNull()
  })

  it('ignores an ellipsis at either end', () => {
    expect(at('…objects too old and distant…')).toEqual(['objects too old and distant'])
    expect(at('objects too old and distant...')).toEqual(['objects too old and distant'])
  })

  it('treats an interior ellipsis as two spans that must both be found', () => {
    expect(at('Its 6.5 meter primary mirror … too old and distant for Hubble')).toEqual(['Its 6.5 meter primary mirror', 'too old and distant for Hubble'])
    expect(at('Its 6.5 meter primary mirror ... a span the source lacks')).toBeNull()
    expect(at('Its 6.5 meter primary mirror ... Hubble.')).toBeNull()
  })
})

describe('a span that joins two passages cannot back supported', () => {
  const item = HAND.find(candidate => candidate.run === 'r3-1' && candidate.hand === 'supported') as Handchecked
  const sources = SOURCES['r3-1'] ?? []

  it('is found, so a partly claim keeps both passages, but an all-pass claim becomes unverified', () => {
    const first = item.spans[0]?.text ?? ''
    const words = first.split(' ')
    const joined = { source: item.spans[0]?.source ?? 1, text: `${words.slice(0, 3).join(' ')} … ${words.slice(-3).join(' ')}` }
    expect(findSpan(sources[0]?.snippet ?? '', joined.text)).not.toBeNull()
    expect(settleHand(item, { spans: [joined] }).verdict).toBe('unverified')
    expect(settleHand(item, { spans: [joined] }).reason).toContain('joins')
    const partly = settleHand(item, { spans: [joined], allPartsCovered: 'no' })
    expect(partly.verdict).toBe('partly')
    expect(partly.quotes).toHaveLength(2)
  })
})

describe('claims about the research itself are typed by the model, never decided by a phrase rule', () => {
  const skipped = JSON.parse(fixture('sp2-skipped-cited-sentences.json')) as Array<{ sentence: string }>
  const sources = SOURCES['r3-1'] ?? []
  const settle = (text: string, over: Partial<Judgment>) => {
    const draft = { id: 1, block: 0, piece: 0, text, cites: [1] }
    return settleClaim(draft, preCheck(text, [1], sources), sources, { id: 1, ...PASS, ...over })
  }

  it.each(skipped.map(item => [item.sentence.slice(0, 60), item.sentence] as const))('is "research" when the model says about_research, whatever the criteria or spans say: %s', (_name, sentence) => {
    const claim = settle(sentence, { kind: 'about_research', sourceSupports: 'no', allPartsCovered: 'no' })
    expect(claim.verdict).toBe('research')
    expect(claim.quotes).toBeUndefined()
    expect(claim.uncovered).toBeUndefined()
  })

  it('is judged like any claim when the model says source_claim, even for "rests on a single source" wording', () => {
    const text = 'The memory-safety claim rests on a single source [1].'
    expect(settle(text, { kind: 'source_claim', sourceSupports: 'no' }).verdict).toBe('unsupported')
    expect(settle(text, { sourceSupports: 'yes', allPartsCovered: 'no' }).verdict).toBe('partly')
  })

  it('never reads the sentence: a plain fact typed about_research is research, and the model owns that choice', () => {
    expect(settle('Rust is a language [1].', { kind: 'about_research' }).verdict).toBe('research')
  })
})

describe('the span check is recorded per claim', () => {
  const item = HAND.find(candidate => candidate.run === 'r3-1' && candidate.hand === 'supported') as Handchecked

  it('keeps the kind, the typed answers and what happened to each span the model asked for', () => {
    const asked = [...item.spans, { source: 1, text: 'invented words that no source holds' }]
    const claim = settleHand(item, { spans: asked, badSpans: 2 })
    expect(claim.verdict).toBe('unverified')
    expect(claim.judged).toEqual({
      kind: 'source_claim',
      answers: { sourceSupports: 'yes', subjectMatches: 'yes', causeMatches: 'not_applicable', allPartsCovered: 'yes' },
      spans: { asked, found: item.spans.length, missed: 1 + 2, joined: 0, malformed: 2 },
    })
  })

  it('keeps it for an unsupported and an unchecked-by-source claim too, and for about_research only the kind', () => {
    expect(settleHand(item, { sourceSupports: 'no' }).judged?.spans).toMatchObject({ found: 0, missed: 0 })
    expect(settleHand(item, { kind: 'about_research' }).judged).toEqual({ kind: 'about_research', spans: { asked: item.spans, found: 0, missed: 0, joined: 0, malformed: 0 } })
  })
})
