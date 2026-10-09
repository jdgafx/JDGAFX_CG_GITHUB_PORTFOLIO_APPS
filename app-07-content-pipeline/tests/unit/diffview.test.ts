import { describe, expect, it } from 'vitest'
import { diffLines, sentenceCaseLine } from '../../src/lib/diffLines'
import { diffWords } from '../../netlify/shared/diff'

const shown = (pieces: Array<{ kind: string; text: string }> = []) => pieces.filter(p => p.text.trim()).map(p => [p.kind, p.text.trim()])

describe('diffLines', () => {
  it('splits the new text into lines, marks headings and list items, and keeps deleted words inline', () => {
    const lines = diffLines(diffWords('## Old Title\n\n- one two\n\nBody text here.', '## New Title\n\n- one three\n\nBody text here.'))
    expect(lines.map(line => line.tag)).toEqual(['h', 'li', 'p'])
    expect(shown(lines[0]?.pieces)).toEqual([['del', 'Old'], ['ins', 'New'], ['equal', 'Title']])
    expect(shown(lines[1]?.pieces)).toEqual([['equal', 'one'], ['del', 'two'], ['ins', 'three']])
  })
})

describe('sentenceCaseLine', () => {
  it('puts the kept words of a Title Case heading into sentence case across pieces, keeping names and removed words', () => {
    const [line] = diffLines(diffWords('## Old Notes on the Rust Language', '## Fresh Notes on the Rust Language'))
    const pieces = sentenceCaseLine(line?.pieces ?? [], ['Rust'])
    expect(shown(pieces)).toEqual([['del', 'Old'], ['ins', 'Fresh'], ['equal', 'notes on the Rust language']])
  })

  it('leaves a heading that is already in sentence case alone', () => {
    const [line] = diffLines(diffWords('## Why it matters', '## Why it matters most'))
    expect(sentenceCaseLine(line?.pieces ?? [], [])).toEqual(line?.pieces)
  })
})
