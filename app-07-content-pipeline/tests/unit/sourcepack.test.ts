import { describe, expect, it } from 'vitest'
import { bodyOf, citableSources, formatSourcePack, listedSources, parseSourcePack, sourceIndex, withSources, type Source, type SourcePack } from '../../netlify/shared/sourcepack'

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

  it('keeps only the sources that have text as the ones a writer may cite', () => {
    expect(citableSources(PACK)).toEqual({ sources: [WIKI], notes: PACK.notes })
  })
})

// A source that has text, for tests of how a claim is matched to a source.
const article = (title: string, n = 1, url = 'https://example.test/article'): Source => ({ n, kind: 'wikipedia', title, url, summary: 'It.' })

describe('withSources', () => {
  const BODY = 'Rust is a general-purpose language [1]. Some argue it is not really about memory safety [2].'
  const CLEAN = 'Rust is a general-purpose language [1]. Some argue it is not really about memory safety.'

  it('ends a blog post with a Sources list of the sources it cites, titles linked, and a Related list of the headline-only stories', () => {
    expect(withSources(BODY, PACK, 'Blog Post')).toBe([
      CLEAN,
      '',
      '### Sources',
      '',
      '- [1] [Rust (programming language)](https://en.wikipedia.org/wiki/Rust_%28programming_language%29), Wikipedia',
      '',
      '### Related on Hacker News',
      '',
      '- [Rust is not about memory safety](https://o-santi.github.io/blog/rust-is-not-about-memory-safety/), 57 points, 2024-06-02',
    ].join('\n'))
  })

  it('lists only cited sources', () => {
    const text = withSources('Rust is a general-purpose language [1].', PACK, 'Technical Article')
    expect(text).toContain('- [1] [Rust (programming language)]')
    expect(text).not.toContain('[2]')
  })

  it('lists every source under a plain heading when the text cites none', () => {
    const text = withSources('No markers here.', PACK, 'Newsletter')
    expect(text).toContain('### Sources consulted (not cited in the text)')
    expect(text).toContain('- [1] ')
    expect(text).not.toContain('- [2] ')
  })

  it('removes a marker that points at no source, with the space before it', () => {
    expect(withSources('A claim [7]. A general-purpose language [1].', PACK, 'Blog Post').startsWith('A claim. A general-purpose language [1].')).toBe(true)
  })

  it('leaves array indexes in code alone', () => {
    expect(withSources('Use items[0] in a general-purpose language [1].', PACK, 'Blog Post').startsWith('Use items[0] in a general-purpose language [1].')).toBe(true)
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

  it('removes a marker whose sentence shares no word with its source, and keeps the sentence', () => {
    const text = withSources('Light from early galaxies is stretched to longer wavelengths [1]. Rust is a general-purpose language [1].', PACK, 'Blog Post')
    expect(text.startsWith('Light from early galaxies is stretched to longer wavelengths. Rust is a general-purpose language [1].')).toBe(true)
  })

  describe('a marker stays unless there is clearly no connection', () => {
    const ASM: SourcePack = {
      sources: [article('From Asm.js to WebAssembly', 3, 'https://brendaneich.com/2015/06/from-asm-js-to-webassembly/')],
      notes: [],
    }
    const keeps = (text: string, pack: SourcePack, marker = '[1]') => withSources(text, pack, 'Blog Post').startsWith(text) && text.includes(marker)

    it('counts the topic words: one shared word, such as the subject itself, is enough', () => {
      const pack: SourcePack = { sources: [{ ...WIKI, title: 'James E. Webb', summary: 'James Webb led NASA from 1961 to 1968.' }], notes: [] }
      expect(keeps('The James Webb telescope measures redshift in early galaxies [1].', pack)).toBe(true)
    })

    it('keeps a marker on a sentence that quotes a title built on a name such as "Asm.js"', () => {
      const text = withSources('The story is told in "From Asm.js to WebAssembly" [3].', ASM, 'Newsletter')
      expect(text.startsWith('The story is told in "From Asm.js to WebAssembly" [3].')).toBe(true)
      expect(text).toContain('- [3] [From Asm.js to WebAssembly]')
    })

    it('keeps a marker on a name such as C# or C++, which are shorter than three letters', () => {
      const csharp: SourcePack = { sources: [article("A comparison of Rust's borrow checker to the one in C#")], notes: [] }
      expect(keeps("A widely discussed post contrasts Rust's borrowing model with the reference-safety rules in C# [1].", csharp)).toBe(true)
      expect(keeps('Pointers are manual in C++ and managed in Java [1].', { sources: [article('Why C++ pointers hurt')], notes: [] })).toBe(true)
    })

    it('matches a word inside a longer one, such as "painting" in "repainting"', () => {
      const paint: SourcePack = { sources: [article('Painting the Eiffel Tower', 5)], notes: [] }
      expect(keeps('Its repainting has drawn attention in its own right [5].', paint, '[5]')).toBe(true)
    })

    it('matches endings of the same word, such as tests and testing', () => {
      const pack: SourcePack = { sources: [article('Unit testing at scale')], notes: [] }
      expect(keeps('Small teams that write tests ship calmer [1].', pack)).toBe(true)
    })

    it('does not match on a short word by accident', () => {
      const pack: SourcePack = { sources: [article('The LHC and CERN')], notes: [] }
      expect(withSources('Lunch was served at noon [1].', pack, 'Blog Post').startsWith('Lunch was served at noon.')).toBe(true)
    })
  })

  describe('the sentence a marker belongs to', () => {
    const MOON: SourcePack = {
      sources: [{ n: 1, kind: 'wikipedia', title: 'Apollo 11', url: 'https://en.wikipedia.org/wiki/Apollo_11', summary: 'Apollo 11 was the first spaceflight to land humans on the Moon, from July 16 to 24, 1969.' }],
      notes: [],
    }

    it('judges "Moon. \u{1F315} [1]" on the sentence before the emoji, so the marker stays', () => {
      const thread = '1/ Apollo 11 carried the first humans to land on the Moon. \u{1F315} [1]'
      expect(withSources(thread, MOON, 'Social Thread').startsWith(thread)).toBe(true)
    })

    it('does the same for other symbols, a variation selector and a few emoji in a row', () => {
      for (const tail of ['\u{1F680} [1]', '\u{1F6F0}\uFE0F [1]', '\u{1F4BB}\u{1F50D} [1]', '\u2728 [1]']) {
        const thread = `Apollo 11 landed on the Moon. ${tail}`
        expect(withSources(thread, MOON, 'Social Thread').startsWith(thread)).toBe(true)
      }
    })

    it('still drops it when the sentence before the emoji has nothing to do with the source', () => {
      const text = withSources('Bananas ripen quickly. \u{1F34C} [1]', MOON, 'Social Thread')
      expect(text.startsWith('Bananas ripen quickly. \u{1F34C}')).toBe(true)
      expect(text).not.toContain('\u{1F34C} [1]')
    })

    it('does not borrow the sentence before it: a marker on a new sentence with an emoji is judged there', () => {
      const text = withSources('Apollo 11 landed on the Moon. Bananas ripen quickly. \u{1F34C} [1]', MOON, 'Social Thread')
      expect(text.startsWith('Apollo 11 landed on the Moon. Bananas ripen quickly. \u{1F34C}')).toBe(true)
      expect(text).not.toContain('\u{1F34C} [1]')
    })
  })

  it('judges each marker of a run such as [1][2] on its own and keeps the ones that hold', () => {
    const text = withSources('A general-purpose language [1][2].', PACK, 'Blog Post')
    expect(text.startsWith('A general-purpose language [1].')).toBe(true)
  })

  it('removes a run of markers that all fail, with the space before it', () => {
    expect(withSources('Bananas ripen quickly [1][2]. Rust is a general-purpose language [1].', PACK, 'Blog Post').startsWith('Bananas ripen quickly. Rust is')).toBe(true)
  })

  it('judges a marker by its own sentence, not the one before it', () => {
    const text = withSources('Rust is a general-purpose language. Bananas ripen quickly [1].', PACK, 'Blog Post')
    expect(text.startsWith('Rust is a general-purpose language. Bananas ripen quickly.')).toBe(true)
  })

  it('uses short, clickable links for a social thread', () => {
    expect(withSources('1/ Rust is a general-purpose language [1].', PACK, 'Social Thread')).toBe([
      '1/ Rust is a general-purpose language [1].',
      '',
      '**Sources**',
      '',
      '- [1] [en.wikipedia.org/wiki/Rust\\_(programming\\_language)](https://en.wikipedia.org/wiki/Rust_%28programming_language%29)',
      '',
      '**Related on Hacker News**',
      '',
      '- [Rust is not about memory safety](https://o-santi.github.io/blog/rust-is-not-about-memory-safety/), 57 points, 2024-06-02',
    ].join('\n'))
  })

  it('cuts a very long short link with an ellipsis', () => {
    const pack: SourcePack = { sources: [article('A title', 1, `https://example.test/${'a'.repeat(80)}`)], notes: [] }
    expect(withSources('Claim [1].', pack, 'Social Thread')).toContain(`[example.test/${'a'.repeat(42)}\u2026](`)
  })

  it('escapes brackets in a title so it cannot break the link', () => {
    const pack: SourcePack = { sources: [{ ...WIKI, title: 'A [draft] *title*' }], notes: [] }
    expect(withSources('Claim [1].', pack, 'Blog Post')).toContain('[A \\[draft\\] \\*title\\*](')
  })

  it('labels a piece with no sources instead of listing any', () => {
    expect(withSources('Text [1] here.', { sources: [], notes: [] }, 'Blog Post')).toBe(
      'Text here.\n\n*No sources: the live lookups found no article to cite for this topic, so the facts above come from the model and are unchecked.*',
    )
  })

  describe('a headline-only source (Hacker News) is never cited, only listed', () => {
    it('removes a marker that points at it, by its type and whatever the sentence says', () => {
      const out = withSources('Rust is not about memory safety, a post argues [2]. A general-purpose language [1][2].', PACK, 'Blog Post')
      expect(bodyOf(out)).toBe('Rust is not about memory safety, a post argues. A general-purpose language [1].')
    })

    it('never moves a marker onto it, even when its headline fits the sentence best', () => {
      const out = withSources('Rust is not about memory safety [1].', PACK, 'Blog Post')
      expect(bodyOf(out)).not.toContain('[2]')
      expect(out).not.toContain('- [2]')
    })

    it('lists it as Related on Hacker News with the exact title linked, and not as a cited source', () => {
      const out = withSources('A general-purpose language [1].', PACK, 'Blog Post')
      expect(out).toContain('### Related on Hacker News\n\n- [Rust is not about memory safety](https://o-santi.github.io/blog/rust-is-not-about-memory-safety/), 57 points, 2024-06-02')
      expect(listedSources(out, PACK)).toEqual({ sources: [WIKI], cited: true })
    })

    it('uses the same list in a social thread, under a bold heading', () => {
      expect(withSources('1/ A general-purpose language [1].', PACK, 'Social Thread')).toContain('**Related on Hacker News**\n\n- [Rust is not about memory safety](')
    })

    it('says no article was found to cite and still lists the stories when only headlines were found', () => {
      const only: SourcePack = { sources: [HN], notes: [] }
      const out = withSources('Claims [2]. More claims.', only, 'Blog Post')
      expect(out).toBe([
        'Claims. More claims.',
        '',
        '*No sources: the live lookups found no article to cite for this topic, so the facts above come from the model and are unchecked.*',
        '',
        '### Related on Hacker News',
        '',
        '- [Rust is not about memory safety](https://o-santi.github.io/blog/rust-is-not-about-memory-safety/), 57 points, 2024-06-02',
      ].join('\n'))
      expect(bodyOf(out)).toBe('Claims. More claims.')
    })

    it('escapes a title so it cannot break the link', () => {
      const out = withSources('Claim [1].', { sources: [WIKI, { ...HN, title: '[2] A *bold* [claim]' }], notes: [] }, 'Blog Post')
      expect(out).toContain('- [\\[2\\] A \\*bold\\* \\[claim\\]](')
      expect(listedSources(out, PACK).sources).toEqual([WIKI])
    })
  })
})

// Two Wikipedia articles with different subjects, and a headline-only story.
const TELESCOPE: Source = { n: 1, kind: 'wikipedia', title: 'James Webb Space Telescope', url: 'https://en.wikipedia.org/wiki/JWST', summary: 'The telescope observes infrared light from distant galaxies using a gold-coated beryllium mirror.' }
const LAUNCH: Source = { n: 2, kind: 'wikipedia', title: 'Ariane 5', url: 'https://en.wikipedia.org/wiki/Ariane_5', summary: 'Ariane 5 launched the observatory from Kourou in French Guiana on Christmas Day 2021.' }
const STORY: Source = { n: 3, kind: 'hackernews', title: 'Webb telescope images debate', url: 'https://example.test/webb-telescope-images-debate', summary: '', points: 80, date: '2022-07-12' }
const SPACE: SourcePack = { sources: [TELESCOPE, LAUNCH, STORY], notes: [] }

describe('relative best-match: a marker moves to the source that fits its sentence clearly better', () => {
  it('re-points a marker whose source fits far worse than another source', () => {
    const out = withSources('It launched from Kourou in French Guiana on Christmas Day [1].', SPACE, 'Blog Post')
    expect(out.split('\n\n### ')[0]).toBe('It launched from Kourou in French Guiana on Christmas Day [2].')
    expect(out).toContain('- [2] [Ariane 5]')
    expect(out).not.toContain('- [1] [James Webb')
  })

  it('keeps a marker whose source fits at least as well as the others', () => {
    const out = withSources('Its beryllium mirror is coated in gold [1].', SPACE, 'Blog Post')
    expect(bodyOf(out)).toBe('Its beryllium mirror is coated in gold [1].')
  })

  it('keeps a marker whose source fits only a little worse, because the difference is not clear', () => {
    // "telescope" fits source 1 and source 3; "launched" fits source 2: 0.5 + ... versus 1: no 2x lead.
    const out = withSources('The telescope was launched [1].', SPACE, 'Blog Post')
    expect(bodyOf(out)).toBe('The telescope was launched [1].')
  })

  it('removes a marker on a headline-only story instead of keeping or moving it', () => {
    const out = withSources('Webb telescope images drew debate [3].', SPACE, 'Blog Post')
    expect(bodyOf(out)).toBe('Webb telescope images drew debate.')
  })

  it('does not move a marker onto a source that is already in its own run', () => {
    const out = withSources('The telescope launched from Kourou in French Guiana [1][2].', SPACE, 'Blog Post')
    expect(bodyOf(out)).toBe('The telescope launched from Kourou in French Guiana [1][2].')
  })

  it('writes a moved marker once when its target is already there', () => {
    const out = withSources('Launched from Kourou in French Guiana [2][1].', SPACE, 'Blog Post')
    expect(bodyOf(out)).toBe('Launched from Kourou in French Guiana [2].')
  })
})

describe('bodyOf', () => {
  it('cuts the appended Sources list, for a list, a social thread and a piece with no sources', () => {
    const cases: Array<[SourcePack, string]> = [[PACK, 'Blog Post'], [PACK, 'Social Thread'], [{ sources: [], notes: [] }, 'Blog Post']]
    for (const [pack, type] of cases) {
      expect(bodyOf(withSources('Rust is a language [1].', pack, type))).toBe(pack.sources.length > 0 ? 'Rust is a language [1].' : 'Rust is a language.')
      expect(bodyOf(withSources('Rust is a language.', pack, type))).toBe('Rust is a language.')
    }
  })

  it('cuts the not-cited list heading too, and leaves text without a list alone', () => {
    expect(bodyOf(withSources('Rust is a language.', PACK, 'Blog Post'))).toBe('Rust is a language.')
    expect(bodyOf('Plain text.\n\n### Sources of joy\n\nstill text')).toBe('Plain text.\n\n### Sources of joy\n\nstill text')
  })
})
