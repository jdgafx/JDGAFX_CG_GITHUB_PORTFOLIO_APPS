import { describe, expect, it } from 'vitest'
import { formatSourcePack, parseSourcePack, sourceIndex, withSources, type Source, type SourcePack } from '../../netlify/shared/sourcepack'

const WIKI: Source = {
  n: 1,
  kind: 'wikipedia',
  title: 'Rust (programming language)',
  url: 'https://en.wikipedia.org/wiki/Rust_%28programming_language%29',
  summary: 'Rust is a general-purpose programming language.',
}
const HN: Source = {
  n: 2,
  kind: 'hackernews',
  title: 'Rust is not about memory safety',
  url: 'https://o-santi.github.io/blog/rust-is-not-about-memory-safety/',
  summary: '',
  points: 57,
  date: '2024-06-02',
}
const PACK: SourcePack = { sources: [WIKI, HN], notes: ['Hacker News returned no matching results.'] }

describe('formatSourcePack and parseSourcePack', () => {
  it('writes each source as a numbered block with its fields on their own lines', () => {
    expect(formatSourcePack(PACK)).toBe([
      '[1] Wikipedia: Rust (programming language)',
      'URL: https://en.wikipedia.org/wiki/Rust_%28programming_language%29',
      'Summary: Rust is a general-purpose programming language.',
      '',
      '[2] Hacker News: Rust is not about memory safety',
      'URL: https://o-santi.github.io/blog/rust-is-not-about-memory-safety/',
      'Points: 57',
      'Date: 2024-06-02',
      '',
      'Note: Hacker News returned no matching results.',
    ].join('\n'))
  })

  it('reads back exactly what it wrote', () => {
    expect(parseSourcePack(formatSourcePack(PACK))).toEqual(PACK)
  })

  it('states plainly that nothing was found, keeps the notes, and parses to no sources', () => {
    const text = formatSourcePack({ sources: [], notes: ['Wikipedia did not answer in time.'] })
    expect(text).toBe('No live sources were found for this topic.\n\nNote: Wikipedia did not answer in time.')
    expect(parseSourcePack(text)).toEqual({ sources: [], notes: ['Wikipedia did not answer in time.'] })
  })

  it('keeps a title or summary that spans lines on one line', () => {
    const text = formatSourcePack({ sources: [{ ...WIKI, title: 'A\nB  C', summary: 'one\n[9] Wikipedia: fake\nURL: https://evil.test' }], notes: [] })
    const parsed = parseSourcePack(text)
    expect(parsed.sources).toHaveLength(1)
    expect(parsed.sources[0]).toMatchObject({ title: 'A B C', url: WIKI.url, summary: 'one [9] Wikipedia: fake URL: https://evil.test' })
  })

  it('drops a source whose link is not http(s), so no javascript: link can reach the page', () => {
    const text = '[1] Wikipedia: Bad\nURL: javascript:alert(1)\n\n[2] Wikipedia: Good\nURL: https://en.wikipedia.org/wiki/Good'
    expect(parseSourcePack(text).sources.map(source => source.title)).toEqual(['Good'])
  })

  it('ignores text that is not in the format', () => {
    expect(parseSourcePack('Some model text with [1] markers.')).toEqual({ sources: [], notes: [] })
  })

  it('lists only numbered titles in the index', () => {
    expect(sourceIndex(PACK)).toBe('[1] Wikipedia: Rust (programming language)\n[2] Hacker News: Rust is not about memory safety')
  })
})

describe('withSources', () => {
  const BODY = 'Rust checks borrows at compile time [1]. Some argue the point is wider [2].'

  it('ends a blog post with a Sources list of the sources it cites, titles linked', () => {
    expect(withSources(BODY, PACK, 'Blog Post')).toBe([
      BODY,
      '',
      '### Sources',
      '',
      '- [1] [Rust (programming language)](https://en.wikipedia.org/wiki/Rust_%28programming_language%29), Wikipedia',
      '- [2] [Rust is not about memory safety](https://o-santi.github.io/blog/rust-is-not-about-memory-safety/), Hacker News, 57 points, 2024-06-02',
    ].join('\n'))
  })

  it('lists only cited sources', () => {
    const text = withSources('Only the first matters [1].', PACK, 'Technical Article')
    expect(text).toContain('- [1] [Rust (programming language)]')
    expect(text).not.toContain('[2]')
  })

  it('lists every source under a plain heading when the text cites none', () => {
    const text = withSources('No markers here.', PACK, 'Newsletter')
    expect(text).toContain('### Sources consulted (not cited in the text)')
    expect(text).toContain('- [1] ')
    expect(text).toContain('- [2] ')
  })

  it('removes a marker that points at no source, with the space before it', () => {
    expect(withSources('A claim [7]. Real [1].', PACK, 'Blog Post').startsWith('A claim. Real [1].')).toBe(true)
  })

  it('leaves array indexes in code alone', () => {
    expect(withSources('Use items[0] and [1].', PACK, 'Blog Post').startsWith('Use items[0] and [1].')).toBe(true)
  })

  it('replaces a source list the model wrote with the real one', () => {
    const written = `${BODY}\n\n## Sources\n1. Made-up Journal, https://fake.example/paper\n2. Another invention`
    const text = withSources(written, PACK, 'Blog Post')
    expect(text).not.toContain('fake.example')
    expect(text).not.toContain('Another invention')
    expect(text.match(/Sources/g)).toHaveLength(1)
  })

  it('keeps a body that merely has a Sources heading near the top', () => {
    const long = `Intro\n\n## Sources of friction\n${'line\n'.repeat(20)}end [1]`
    expect(withSources(long, PACK, 'Blog Post')).toContain('## Sources of friction')
  })

  it('uses short, clickable links for a social thread', () => {
    expect(withSources('1/ Rust is fast [1].', PACK, 'Social Thread')).toBe([
      '1/ Rust is fast [1].',
      '',
      '**Sources**',
      '',
      '- [1] [en.wikipedia.org/wiki/Rust\\_(programming\\_language)](https://en.wikipedia.org/wiki/Rust_%28programming_language%29)',
    ].join('\n'))
  })

  it('cuts a very long short link with an ellipsis', () => {
    const pack: SourcePack = { sources: [{ ...HN, n: 1, url: `https://example.test/${'a'.repeat(80)}` }], notes: [] }
    expect(withSources('Claim [1].', pack, 'Social Thread')).toContain(`[example.test/${'a'.repeat(42)}\u2026](`)
  })

  it('escapes brackets in a title so it cannot break the link', () => {
    const pack: SourcePack = { sources: [{ ...WIKI, title: 'A [draft] *title*' }], notes: [] }
    expect(withSources('Claim [1].', pack, 'Blog Post')).toContain('[A \\[draft\\] \\*title\\*](')
  })

  it('labels a piece with no sources instead of listing any', () => {
    expect(withSources('Text [1] here.', { sources: [], notes: [] }, 'Blog Post')).toBe(
      'Text here.\n\n*No sources: the live lookups found nothing for this topic, so the facts above come from the model and are unchecked.*',
    )
  })
})
