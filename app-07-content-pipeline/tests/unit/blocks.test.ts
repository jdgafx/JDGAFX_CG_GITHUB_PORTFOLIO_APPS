import { describe, expect, it } from 'vitest'
import { parseBlocks } from '../../src/lib/blocks'

describe('parseBlocks', () => {
  it('reads headings, paragraphs and lists, and joins wrapped paragraph lines', () => {
    expect(parseBlocks('## Why it matters\n\nFirst line\ncontinues here.\n\n- one [1]\n- two\n\n1. step\n2) next\n\n---\n\n#### Deep')).toEqual([
      { kind: 'heading', level: 2, text: 'Why it matters' },
      { kind: 'paragraph', text: 'First line continues here.' },
      { kind: 'list', ordered: false, items: ['one [1]', 'two'] },
      { kind: 'list', ordered: true, items: ['step', 'next'] },
      { kind: 'rule' },
      { kind: 'heading', level: 4, text: 'Deep' },
    ])
  })

  it('caps heading depth at four and ends a paragraph at a heading or list with no blank line', () => {
    expect(parseBlocks('text\n# Top\n###### Tiny\n* item')).toEqual([
      { kind: 'paragraph', text: 'text' },
      { kind: 'heading', level: 1, text: 'Top' },
      { kind: 'heading', level: 4, text: 'Tiny' },
      { kind: 'list', ordered: false, items: ['item'] },
    ])
  })

  it('keeps tags as text and returns nothing for empty text', () => {
    expect(parseBlocks('<b>x</b>')).toEqual([{ kind: 'paragraph', text: '<b>x</b>' }])
    expect(parseBlocks('  \n')).toEqual([])
  })
})
