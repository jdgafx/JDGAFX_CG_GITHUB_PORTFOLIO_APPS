import { describe, expect, it } from 'vitest'
import { inlineToText, parseBlocks, parseInline } from '../../src/lib/markdown'

describe('parseBlocks', () => {
  it('turns each markdown construct into its own block, in order', () => {
    const source = [
      '# Title',
      'Some **bold** text',
      '- one',
      '* two',
      '1. first',
      '> quoted',
      '---',
      '```js',
      'const x = 1',
      '```',
      '| Name | Value |',
      '| --- | :---: |',
      '| a | 1 |',
    ].join('\n')

    const blocks = parseBlocks(source)
    expect(blocks.map(block => block.kind)).toEqual([
      'heading',
      'paragraph',
      'bullet',
      'bullet',
      'numbered',
      'quote',
      'rule',
      'code',
      'table',
    ])
    expect(blocks[0]).toEqual({ kind: 'heading', level: 1, text: 'Title' })
    expect(blocks[2]).toEqual({ kind: 'bullet', text: 'one' })
    expect(blocks[3]).toEqual({ kind: 'bullet', text: 'two' })
    expect(blocks[4]).toEqual({ kind: 'numbered', marker: '1', text: 'first' })
    expect(blocks[7]).toEqual({ kind: 'code', lang: 'js', lines: ['const x = 1'] })
    expect(blocks[8]).toEqual({ kind: 'table', header: ['Name', 'Value'], rows: [['a', '1']] })
  })

  it('caps heading depth at level 3', () => {
    expect(parseBlocks('#### Deep')[0]).toEqual({ kind: 'heading', level: 3, text: 'Deep' })
  })

  it('keeps blank lines as blank blocks', () => {
    expect(parseBlocks('a\n\nb').map(block => block.kind)).toEqual(['paragraph', 'blank', 'paragraph'])
  })
})

describe('parseInline', () => {
  it('splits bold, code, links and italics out of plain text', () => {
    expect(parseInline('a **b** `c` [d](https://e.test) *f* _g_')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'd', href: 'https://e.test' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'f' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'g' },
    ])
  })

  it('leaves a lone asterisk with spaces around it as text', () => {
    expect(inlineToText('5 * 3 * 2')).toBe('5 * 3 * 2')
  })
})

describe('inlineToText', () => {
  it('flattens links to their label and address, and drops emphasis markers', () => {
    expect(inlineToText('[docs](https://x.test) and **bold**')).toBe('docs (https://x.test) and bold')
  })
})
