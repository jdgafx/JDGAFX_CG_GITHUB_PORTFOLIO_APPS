import { describe, expect, it } from 'vitest'
import { hasSourcesSection, sourcesMarkdown, stripBadCitations, withSources } from '../../src/lib/sources'
import type { Source } from '../../src/types'

const WIKI: Source = { n: 1, title: 'Rust [programming language]', site: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Rust_%28programming_language%29', snippet: 's' }
const HN: Source = { n: 2, title: 'Why Rust', site: 'Hacker News', url: 'https://news.ycombinator.com/item?id=9', snippet: 's', note: '120 points, 40 comments, Mar 2024' }

describe('sourcesMarkdown', () => {
  it('lists each source as a numbered link with its site and note, brackets in titles made safe', () => {
    expect(sourcesMarkdown([WIKI, HN])).toBe(
      [
        '### Sources',
        '',
        '1. [Rust (programming language)](https://en.wikipedia.org/wiki/Rust_%28programming_language%29) - Wikipedia',
        '2. [Why Rust](https://news.ycombinator.com/item?id=9) - Hacker News, 120 points, 40 comments, Mar 2024',
      ].join('\n'),
    )
  })

  it('says plainly that nothing was retrieved', () => {
    expect(sourcesMarkdown([])).toBe('### Sources\n\nNo sources were retrieved. This report rests on model memory and is unverified.')
  })
})

describe('withSources and hasSourcesSection', () => {
  it('appends the section after the report text and detects it', () => {
    const report = withSources('Body [2].\n\n', [HN])
    expect(report).toBe('Body [2].\n\n### Sources\n\n2. [Why Rust](https://news.ycombinator.com/item?id=9) - Hacker News, 120 points, 40 comments, Mar 2024\n')
    expect(hasSourcesSection(report)).toBe(true)
    expect(hasSourcesSection('Body [2]. No list here.')).toBe(false)
  })
})

describe('stripBadCitations', () => {
  it('removes every marker and placeholder when there are no sources, and tidies the spacing', () => {
    expect(stripBadCitations('- Fact one [1]. Fact two [n] and [number], also [2, 3].\n- [4] starts a line', 0)).toBe(
      '- Fact one. Fact two and, also.\n- starts a line',
    )
  })

  it('keeps markers inside 1..N and drops the numbers outside it', () => {
    expect(stripBadCitations('A [1]. B [3]. C [2, 7]. D [0]. E [12].', 3)).toBe('A [1]. B [3]. C [2]. D. E.')
  })

  it('leaves other brackets and markdown links alone', () => {
    const text = 'See [the docs](https://example.com) and [1](https://example.com/x) and [citation needed].'
    expect(stripBadCitations(text, 0)).toBe(text)
  })
})
