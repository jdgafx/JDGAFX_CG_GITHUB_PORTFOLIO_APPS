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
  it('cuts the words each neighbour shares with the passage, so nothing is shown twice', () => {
    const before = 'The first part ends with the shared words here'
    const passage = 'with the shared words here and the middle part ends with the next shared tail'
    const after = 'the next shared tail and then the last part'
    expect(contextAround(before, passage, after)).toEqual({ before: 'The first part ends', after: 'and then the last part' })
  })

  it('gives empty context at the ends of the document and cuts long context at a word', () => {
    expect(contextAround(undefined, 'only passage', undefined)).toEqual({ before: '', after: '' })
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
