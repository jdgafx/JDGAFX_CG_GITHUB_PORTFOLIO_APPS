import { describe, expect, it } from 'vitest'
import { contextAround, parseAnswer, sentencesCiting, splitSentences, supportingSentence, supportingSentences } from '../../src/lib/evidence'

describe('parseAnswer', () => {
  const answer = 'The station opened in 1987 [Chunk 3]. It handles freight. [Chunk 0, Chunk 5] Nothing else is said (Chunk 9).'
  const parsed = parseAnswer(answer, [0, 3])

  it('splits the answer into sentences without the markers', () => {
    expect(parsed.sentences).toEqual(['The station opened in 1987.', 'It handles freight.', 'Nothing else is said .'.replace(' .', '.')])
  })

  it('attaches a marker to the sentence it follows, even when it comes after the full stop', () => {
    const cites = parsed.parts.flatMap(p => (p.kind === 'cite' ? [[p.indices, p.sentence]] : []))
    expect(cites).toEqual([
      [[3], 0],
      [[0], 1],
    ])
  })

  it('drops passages that were not sent, and a marker that names none', () => {
    // Chunk 5 and Chunk 9 were not sent, so only [0] survives from the second marker and the third marker is gone.
    expect(parsed.parts.filter(p => p.kind === 'cite')).toHaveLength(2)
  })

  it('reads a list in one bracket and leaves an answer with no markers as plain text', () => {
    const list = parseAnswer('Both agree [Chunk 1 and Chunk 2].', [1, 2])
    expect(list.parts.find(p => p.kind === 'cite')).toEqual({ kind: 'cite', indices: [1, 2], sentence: 0 })
    expect(parseAnswer('The document does not say.', []).parts).toEqual([
      { kind: 'text', text: 'The document does not say.', sentence: 0 },
    ])
  })
})

describe('splitSentences', () => {
  it('cuts at a full stop followed by a capital letter or digit, with positions', () => {
    const text = 'It opened in 1987. The 2nd phase followed? Yes. later text stays'
    const found = splitSentences(text)
    expect(found.map(s => s.text)).toEqual(['It opened in 1987.', 'The 2nd phase followed?', 'Yes. later text stays'])
    for (const s of found) expect(text.slice(s.start, s.end)).toBe(s.text)
  })

  it('keeps a passage that starts mid-sentence as it is', () => {
    expect(splitSentences('ing of the bridge was late.').map(s => s.text)).toEqual(['ing of the bridge was late.'])
  })
})

describe('supportingSentence', () => {
  const passage = 'The port handles freight. The Harbor Station was opened in 1987 in Lisbon. It closed in 2001.'

  it('picks the sentence that shares the most content words with the answer sentence', () => {
    const support = supportingSentence(passage, ['The station opened in 1987.'])
    expect(support?.sentence.text).toBe('The Harbor Station was opened in 1987 in Lisbon.')
    expect(support?.shared.sort()).toEqual(['1987', 'opened', 'station'])
    expect(passage.slice(support?.sentence.start, support?.sentence.end)).toBe(support?.sentence.text)
  })

  it('goes to the earlier sentence on a tie, so the choice is the same every time', () => {
    expect(supportingSentence('Alpha beta here. Gamma beta there.', ['beta'])?.sentence.text).toBe('Alpha beta here.')
  })

  it('takes the best match over several answer sentences', () => {
    const support = supportingSentence(passage, ['Freight moves.', 'It closed in 2001.'])
    expect(support?.sentence.text).toBe('It closed in 2001.')
  })

  it('returns null when no sentence shares a word, so nothing is highlighted on a guess', () => {
    expect(supportingSentence(passage, ['Penguins swim.'])).toBeNull()
  })
})

describe('sentencesCiting', () => {
  const parsed = parseAnswer('First claim [Chunk 1]. Second claim [Chunk 2]. Third claim [Chunk 1].', [1, 2, 7])

  it('lists the sentences that cite the passage, in order', () => {
    expect(sentencesCiting(parsed, 1)).toEqual(['First claim.', 'Third claim.'])
    expect(sentencesCiting(parsed, 2)).toEqual(['Second claim.'])
  })

  it('uses the whole answer for a source the model listed without marking it', () => {
    expect(sentencesCiting(parsed, 7)).toEqual(['First claim.', 'Second claim.', 'Third claim.'])
  })
})

describe('contextAround', () => {
  it('keeps both halves of a word the overlap cut and joins them with no space', () => {
    // The passage starts inside "that" and ends inside "light-dependent".
    const prev = 'archaeal cyanobacteria preceding that of cyanobacteria (see Purple Earth hypothesis).'
    const passage = 'at of cyanobacteria (see Purple Earth hypothesis). While the details differ. In these li'
    const next = 'In these light-dependent reactions, some energy is used'
    const c = contextAround(prev, passage, next)
    expect(c).toEqual({
      before: 'archaeal cyanobacteria preceding th',
      after: 'ght-dependent reactions, some energy is used',
      joinBefore: true,
      joinAfter: true,
    })
    // As the panel renders it: before + passage + after, with no space at a join.
    const shown = `${c.before}${c.joinBefore ? '' : ' '}${passage}${c.joinAfter ? '' : ' '}${c.after}`
    expect(shown).toContain('preceding that of')
    expect(shown).toContain('light-dependent reactions')
  })

  it('rejoins "model" and "oxidation" cut at a passage edge', () => {
    const a = contextAround('and the big mo', 'odel achieves a score of 41.0, outperforming', undefined)
    expect(a.before).toBe('and the big mo')
    expect(a.joinBefore).toBe(false) // no overlap in this pair, so nothing is joined
    const prev = 'The big model achieves'
    const passage = 'odel achieves a BLEU of 41.0 and the x'
    const next = 'and the xidation of water'
    const c = contextAround(prev, passage, next)
    expect(`${c.before}${c.joinBefore ? '' : ' '}${passage}`).toContain('big model achieves')
    expect(`${passage}${c.joinAfter ? '' : ' '}${c.after}`).toContain('xidation of water')
  })

  it('cuts the words each neighbour shares with the passage, so nothing is shown twice', () => {
    const before = 'The first part ends with the shared words here'
    const passage = 'with the shared words here and the middle part ends with the next shared tail'
    const after = 'the next shared tail and then the last part'
    expect(contextAround(before, passage, after)).toMatchObject({ before: 'The first part ends', after: 'and then the last part' })
  })

  it('gives empty context at the ends of the document and cuts long context at a word', () => {
    expect(contextAround(undefined, 'only passage', undefined)).toMatchObject({ before: '', after: '' })
    const long = 'word '.repeat(100)
    const { before, after } = contextAround(long, 'unrelated passage text', long, 20)
    expect(before).toBe('word word word')
    expect(after).toBe('word word word word')
  })
})

describe('supportingSentences', () => {
  const passage = 'Together they spent two and a half hours walking. Armstrong stepped out six hours after landing. The flag was planted.'

  it('marks the best sentence for each answer sentence that cites the passage, in passage order', () => {
    const found = supportingSentences(passage, ['Armstrong stepped out six hours after landing.', 'They spent two and a half hours walking.'])
    expect(found.map(s => s.sentence.text)).toEqual([
      'Together they spent two and a half hours walking.',
      'Armstrong stepped out six hours after landing.',
    ])
  })

  it('gives one entry when two answer sentences pick the same sentence', () => {
    expect(supportingSentences(passage, ['six hours', 'Armstrong landing']).map(s => s.sentence.text)).toEqual([
      'Armstrong stepped out six hours after landing.',
    ])
  })

  it('is empty when nothing is shared', () => {
    expect(supportingSentences(passage, ['Penguins swim.'])).toEqual([])
  })
})

describe('supporting sentence: overlap fragment and ties', () => {
  const passage =
    'small engine to return them to lunar orbit. After a three-day transit, Armstrong and Aldrin descended to the surface aboard the LM Eagle while Collins remained in lunar orbit aboard the CM Columbia.'

  it('skips the tail of the previous passage that opens the text when another sentence matches', () => {
    // Both sentences share two words with the answer sentence; the fragment is earlier but is not the claim.
    const found = supportingSentences(passage, ['He remained in orbit to return to Earth.'])
    expect(found.map(s => s.sentence.text)).toEqual([expect.stringMatching(/^After a three-day transit/)])
  })

  it('still uses the fragment when it is the only sentence that matches', () => {
    expect(supportingSentences(passage, ['The engine returns them.']).map(s => s.sentence.text)).toEqual([
      'small engine to return them to lunar orbit.',
    ])
  })

  it('breaks a tie on the number of words by the rarer shared words', () => {
    // "Rocket" is in one sentence only; "launch" is in both. Each sentence shares two words, the rarer pair wins.
    const text = 'The launch was early. The rocket launch was late. The pad was empty.'
    const found = supportingSentences(text, ['The rocket launch.'])
    expect(found.map(s => s.sentence.text)).toEqual(['The rocket launch was late.'])
  })
})

describe('parseAnswer: a dropped marker leaves no stray space', () => {
  it('removes the space before an invalid marker', () => {
    const parsed = parseAnswer('Photosynthetic bacteria [Chunk 99], but not archaea [Chunk 3].', [3])
    expect(parsed.parts[0]).toEqual({ kind: 'text', text: 'Photosynthetic bacteria', sentence: 0 })
    expect(parsed.parts[1]).toEqual({ kind: 'text', text: ', but not archaea ', sentence: 0 })
    expect(parsed.sentences).toEqual(['Photosynthetic bacteria, but not archaea.'])
  })
})

describe('splitSentences: PDF spacing inside numbers', () => {
  it('does not split at a spaced full stop between digits', () => {
    expect(splitSentences('The big model achieves a BLEU score of 41 . 0 , outperforming all. Next one follows.').map(s => s.text)).toEqual([
      'The big model achieves a BLEU score of 41 . 0 , outperforming all.',
      'Next one follows.',
    ])
  })
})

describe('supporting sentence: the opening fragment', () => {
  it('is used when it shares more words than any whole sentence (the cited text starts the passage)', () => {
    const passage = 'odel achieves a BLEU score of 41 . 0 , outperforming all single models. The Transformer big model trained for French used dropout.'
    const found = supportingSentences(passage, ['The model achieves a BLEU score of 41.0.'])
    expect(found.map(s => s.sentence.start)).toEqual([0])
  })
})
