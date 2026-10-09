import { describe, expect, it } from 'vitest'
import { parseBlocks } from '../../src/lib/blocks'

describe('parseBlocks', () => {
  it('reads headings, paragraphs and bullet and numbered lists', () => {
    expect(parseBlocks('## Scene\nA red sign\non a pole.\n\n- one\n- two\n  more\n\n1. first\n2) second')).toEqual([
      { kind: 'heading', level: 2, text: 'Scene' },
      { kind: 'paragraph', text: 'A red sign on a pole.' },
      { kind: 'list', ordered: false, items: ['one', 'two more'] },
      { kind: 'list', ordered: true, items: ['first', 'second'] },
    ])
  })

  it('reads a table with its header and rows, including a half-streamed last row', () => {
    expect(parseBlocks('| Year | Sales |\n|---|:--:|\n| 2020 | 4 |\n| 2021 | 7')).toEqual([
      { kind: 'table', head: ['Year', 'Sales'], rows: [['2020', '4'], ['2021', '7']] },
    ])
  })

  it('keeps a code fence as one block, even before it is closed', () => {
    expect(parseBlocks('```\nx = 1\ny = 2\n```\nafter')).toEqual([
      { kind: 'code', text: 'x = 1\ny = 2' },
      { kind: 'paragraph', text: 'after' },
    ])
    expect(parseBlocks('```\nx = 1')).toEqual([{ kind: 'code', text: 'x = 1' }])
  })

  it('drops rules, joins quote lines and leaves html as plain text', () => {
    expect(parseBlocks('---\n> a\n> b\n<script>x</script>')).toEqual([
      { kind: 'quote', text: 'a b' },
      { kind: 'paragraph', text: '<script>x</script>' },
    ])
  })

  it('returns nothing for blank text', () => {
    expect(parseBlocks('  \n\n')).toEqual([])
  })
})
