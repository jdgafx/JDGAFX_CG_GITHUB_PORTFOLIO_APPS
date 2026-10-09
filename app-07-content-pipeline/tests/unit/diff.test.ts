import { describe, expect, it } from 'vitest'
import { diffStats, diffWords, sideWords } from '../../netlify/shared/diff'

const show = (before: string, after: string) => diffWords(before, after).map(s => [s.kind, s.text.trim()])

describe('diffWords', () => {
  it('returns one equal segment for identical text', () => {
    expect(show('a b c', 'a b c')).toEqual([['equal', 'a b c']])
  })

  it('marks an inserted word and a deleted word', () => {
    expect(show('the quick fox', 'the quick brown fox')).toEqual([['equal', 'the quick'], ['ins', 'brown'], ['equal', 'fox']])
    expect(show('the quick brown fox', 'the quick fox')).toEqual([['equal', 'the quick'], ['del', 'brown'], ['equal', 'fox']])
  })

  it('puts the deletion before the insertion for a replaced word', () => {
    expect(show('a built b', 'a delivers b')).toEqual([['equal', 'a'], ['del', 'built'], ['ins', 'delivers'], ['equal', 'b']])
  })

  it('finds the longest common run, not just the first match', () => {
    expect(show('one two three four five', 'five one two three four')).toEqual([['ins', 'five'], ['equal', 'one two three four'], ['del', 'five']])
  })

  it('treats punctuation as part of a word, and prints equal words as they are in the new text', () => {
    expect(show('It works, well.', 'It works well.')).toEqual([['equal', 'It'], ['del', 'works,'], ['ins', 'works'], ['equal', 'well.']])
    expect(diffWords('a b', 'a\n\nb').map(s => s.text).join('')).toBe('a\n\nb')
  })

  it('rebuilds the new text from the equal and inserted segments, and the old text from equal and deleted', () => {
    const before = 'Rust is a language built for speed. It has no garbage collector.'
    const after = 'Rust is a language designed for speed and safety. It has no garbage collector at all.'
    const segments = diffWords(before, after)
    const join = (keep: string[]) => segments.filter(s => keep.includes(s.kind)).map(s => s.text).join('').replace(/\s+/g, ' ').trim()
    expect(join(['equal', 'ins'])).toBe(after)
    expect(join(['equal', 'del'])).toBe(before)
  })

  it('handles empty sides', () => {
    expect(show('', 'a b')).toEqual([['ins', 'a b']])
    expect(show('a b', '')).toEqual([['del', 'a b']])
    expect(diffWords('', '')).toEqual([])
  })
})

describe('diffStats', () => {
  it('counts added and removed words', () => {
    const stats = diffStats(diffWords('the old plan works', 'the new and better plan works'))
    expect(stats).toMatchObject({ added: 3, removed: 1 })
  })

  it('counts a sentence once however many words in it were inserted, and ignores untouched and deleted-only ones', () => {
    const before = 'First sentence stays. Second sentence is short. Third goes away entirely.'
    const after = 'First sentence stays. Second sentence is now much longer. '
    const stats = diffStats(diffWords(before, after))
    expect(stats.sentencesRewritten).toBe(1)
    expect(stats.added).toBe(3)
    expect(stats.removed).toBe(5)
  })

  it('counts nothing for identical text', () => {
    expect(diffStats(diffWords('same words here.', 'same words here.'))).toEqual({ added: 0, removed: 0, sentencesRewritten: 0 })
  })
})

describe('sideWords', () => {
  it('lists the new side with inserted words flagged, and the old side with deleted words flagged', () => {
    const segments = diffWords('a b c', 'a x c')
    expect(sideWords(segments, 'new')).toEqual([{ word: 'a', changed: false }, { word: 'x', changed: true }, { word: 'c', changed: false }])
    expect(sideWords(segments, 'old')).toEqual([{ word: 'a', changed: false }, { word: 'b', changed: true }, { word: 'c', changed: false }])
  })
})
