import { describe, expect, it } from 'vitest'
import { charCount, countParts, diffWords, sameAnswer, sourceDelta } from '../../src/lib/fork'
import type { ResultFrame } from '../../netlify/shared/events'

// Answers recorded from live runs on 2026-10-09: the Blade Runner question, then the same run rewound at the plan
// with the queries "Do Androids Dream of Electric Sheep?" and "Philip K. Dick".
const BEFORE = 'The novel was written by American writer Philip K. Dick [1]. It was first published in 1968 [1].'
const AFTER =
  'The novel is *Do Androids Dream of Electric Sheep?* by American writer Philip K. Dick [1]. It was first published in 1968 [1]. Dick was an American science fiction writer who wrote 45 novels [2].'

describe('diffWords', () => {
  it('keeps a shared sentence and marks what the rewind added', () => {
    const parts = diffWords(BEFORE, AFTER)
    expect(parts.filter((p) => p.kind === 'add').map((p) => p.text)).toEqual([
      'is *Do Androids Dream of Electric Sheep?*',
      'Dick was an American science fiction writer who wrote 45 novels [2].',
    ])
    expect(parts.filter((p) => p.kind === 'del').map((p) => p.text)).toEqual(['was written'])
    expect(parts.find((p) => p.text.includes('It was first published in 1968 [1].'))?.kind).toBe('same')
  })

  it('rebuilds both texts from the parts', () => {
    const parts = diffWords(BEFORE, AFTER)
    expect(parts.filter((p) => p.kind !== 'add').map((p) => p.text).join(' ')).toBe(BEFORE)
    expect(parts.filter((p) => p.kind !== 'del').map((p) => p.text).join(' ')).toBe(AFTER)
  })

  it('counts words', () => {
    expect(countParts(diffWords(BEFORE, AFTER))).toEqual({ same: 16, added: 19, removed: 2 })
  })

  it('handles empty and identical text', () => {
    expect(diffWords('', '')).toEqual([])
    expect(diffWords('a b', 'a b')).toEqual([{ kind: 'same', text: 'a b' }])
    expect(diffWords('', 'a b')).toEqual([{ kind: 'add', text: 'a b' }])
  })
})

const frame = (answer: string, titles: string[]): ResultFrame => ({
  type: 'result', answer, sources: titles.map((title, i) => ({ n: i + 1, title, url: `https://en.wikipedia.org/wiki/${title}` })),
  critic: { verdict: 'accept', notes: '', reviewed: true }, ending: { kind: 'complete', message: '' }, path: [], evidenceCount: titles.length,
  toolRounds: 1, revisions: 0, truncated: false, totals: { ms: 1, unpricedRows: 0 }, models: [],
})

describe('sourceDelta', () => {
  it('compares pages by url, not by number', () => {
    const before = frame(BEFORE, ['Do_Androids'])
    const after = frame(AFTER, ['Do_Androids', 'Philip_K._Dick'])
    const delta = sourceDelta(before.sources, after.sources)
    expect(delta.kept.map((s) => s.title)).toEqual(['Do_Androids'])
    expect(delta.added.map((s) => s.title)).toEqual(['Philip_K._Dick'])
    expect(delta.dropped).toEqual([])
  })
  it('sameAnswer ignores spacing only', () => {
    expect(sameAnswer(frame('a  b\n', []), frame('a b', []))).toBe(true)
    expect(sameAnswer(frame('a b', []), frame('a c', []))).toBe(false)
  })
})

it('charCount counts characters the way the server does', () => {
  expect(charCount('  😀😀 ')).toBe(2)
})
