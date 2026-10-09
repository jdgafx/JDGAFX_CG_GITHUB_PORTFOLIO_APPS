import { describe, expect, it } from 'vitest'
import { LOADER_MAX_CHARS, MAX_CHARS, MIN_CHARS } from '../../src/lib/limits'
import {
  articleUrl,
  buildArticle,
  cleanExtract,
  extractUrl,
  readPage,
  readSearch,
  searchUrl,
  SUGGESTED_TITLES,
  trimToLimit,
  WikiError,
} from '../../src/lib/wikipedia'

/** The shape en.wikipedia.org/w/api.php returns with formatversion=2, recorded for the tests. */
const okPage = {
  batchcomplete: true,
  query: {
    redirects: [{ from: 'apollo 11', to: 'Apollo 11' }],
    pages: [
      {
        pageid: 662,
        ns: 0,
        title: 'Apollo 11',
        extract: 'Apollo 11 was the first crewed mission to land on the Moon.\n\n\n== Crew ==\nThree astronauts flew.',
        fullurl: 'https://en.wikipedia.org/wiki/Apollo_11',
      },
    ],
  },
}

describe('URL building', () => {
  it('builds a CORS-enabled search request for titles in the main namespace', () => {
    const url = new URL(searchUrl('  apollo 11 '))

    expect(url.origin + url.pathname).toBe('https://en.wikipedia.org/w/api.php')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: 'json',
      formatversion: '2',
      origin: '*',
      action: 'query',
      list: 'search',
      srsearch: 'apollo 11',
      srnamespace: '0',
      srlimit: '6',
      srprop: '',
    })
  })

  it('builds a whole-article plain-text request that follows redirects and flags disambiguation pages', () => {
    const url = new URL(extractUrl('Zürich & Co'))

    expect(url.searchParams.get('titles')).toBe('Zürich & Co')
    expect(url.searchParams.get('explaintext')).toBe('1')
    expect(url.searchParams.get('redirects')).toBe('1')
    expect(url.searchParams.get('prop')).toBe('extracts|pageprops|info')
    expect(url.searchParams.get('ppprop')).toBe('disambiguation')
    expect(url.searchParams.get('origin')).toBe('*')
    expect(url.searchParams.has('exintro')).toBe(false)
  })

  it('links to the article with underscores and readable punctuation', () => {
    expect(articleUrl('Apollo 11')).toBe('https://en.wikipedia.org/wiki/Apollo_11')
    expect(articleUrl('Mercury (planet)')).toBe('https://en.wikipedia.org/wiki/Mercury_(planet)')
    expect(articleUrl('AC/DC')).toBe('https://en.wikipedia.org/wiki/AC%2FDC')
  })

  it('offers three suggested titles and no text', () => {
    expect(SUGGESTED_TITLES).toHaveLength(3)
    expect(new Set(SUGGESTED_TITLES).size).toBe(3)
  })
})

describe('readSearch', () => {
  it('returns the titles in order', () => {
    const json = { query: { search: [{ ns: 0, title: 'Apollo 11', pageid: 662 }, { ns: 0, title: 'Apollo program', pageid: 1461 }] } }

    expect(readSearch(json)).toEqual(['Apollo 11', 'Apollo program'])
  })

  it('gives an empty list for an empty or odd reply', () => {
    expect(readSearch({ query: { search: [] } })).toEqual([])
    expect(readSearch({ error: { code: 'x' } })).toEqual([])
    expect(readSearch(null)).toEqual([])
    expect(readSearch({ query: { search: [{ title: 5 }, { title: ' ' }, 'x', { title: 'Kept' }] } })).toEqual(['Kept'])
  })
})

describe('readPage', () => {
  it('reads the resolved title, the canonical URL and the extract', () => {
    expect(readPage(okPage)).toEqual({
      kind: 'ok',
      title: 'Apollo 11',
      url: 'https://en.wikipedia.org/wiki/Apollo_11',
      extract: okPage.query.pages[0]?.extract,
    })
  })

  it('falls back to a built URL when the reply carries none', () => {
    const page = readPage({ query: { pages: [{ title: 'Dodo', extract: 'Text' }] } })

    expect(page).toMatchObject({ kind: 'ok', url: 'https://en.wikipedia.org/wiki/Dodo' })
  })

  it('recognises a missing page', () => {
    expect(readPage({ query: { pages: [{ title: 'Zzqxjkwn', missing: true }] } })).toEqual({ kind: 'missing', title: 'Zzqxjkwn' })
  })

  it('recognises a disambiguation page even though it has an extract', () => {
    const json = { query: { pages: [{ title: 'Mercury', extract: 'Mercury may refer to:', pageprops: { disambiguation: '' } }] } }

    expect(readPage(json)).toEqual({ kind: 'disambiguation', title: 'Mercury' })
  })

  it('treats a reply with no page or no extract as invalid', () => {
    expect(readPage({ error: { code: 'badvalue' } })).toEqual({ kind: 'invalid' })
    expect(readPage({ query: { pages: [] } })).toEqual({ kind: 'invalid' })
    expect(readPage({ query: { pages: [{ title: 'X' }] } })).toEqual({ kind: 'invalid' })
    expect(readPage('<html>')).toEqual({ kind: 'invalid' })
  })
})

describe('cleanExtract', () => {
  it('puts one blank line between paragraphs and keeps headings as plain lines', () => {
    const raw = 'First paragraph.\nSecond paragraph.\n\n\n== History ==\nOld times.\n\n=== Early years ===\nLong ago.'

    expect(cleanExtract(raw)).toBe('First paragraph.\n\nSecond paragraph.\n\nHistory\n\nOld times.\n\nEarly years\n\nLong ago.')
  })

  it('drops the first end-matter section and everything after it', () => {
    const raw = 'Body text.\n\n== See also ==\nOther page\n\n== Legacy ==\nNever kept\n\n== References =='

    expect(cleanExtract(raw)).toBe('Body text.')
  })

  it('keeps a sub-section that merely shares an end-matter name', () => {
    expect(cleanExtract('Body.\n\n=== Notes ===\nA subsection about notes.')).toBe('Body.\n\nNotes\n\nA subsection about notes.')
  })

  it('normalises odd whitespace, CRLF and zero-width characters', () => {
    expect(cleanExtract('A b​  c\r\n\r\n  D  \t e')).toBe('A b c\n\nD e')
  })
})

describe('trimToLimit', () => {
  it('leaves text within the limit alone', () => {
    expect(trimToLimit('Short.', 100)).toEqual({ text: 'Short.', trimmed: false })
    expect(trimToLimit('x'.repeat(100), 100).trimmed).toBe(false)
  })

  it('cuts on the last paragraph break at or before the limit', () => {
    const [a, b, c] = ['a'.repeat(39), 'b'.repeat(39), 'c'.repeat(39)].map((p) => `${p}.`)
    const text = `${a}\n\n${b}\n\n${c}`

    const out = trimToLimit(text, 90)

    expect(out).toEqual({ text: `${a}\n\n${b}`, trimmed: true })
    expect(out.text.length).toBe(82)
  })

  it('keeps a paragraph that ends exactly at the limit', () => {
    const [a, b, c] = ['a'.repeat(39), 'b'.repeat(47), 'c'.repeat(39)].map((p) => `${p}.`)
    const text = `${a}\n\n${b}\n\n${c}`

    expect(trimToLimit(text, 90).text).toBe(`${a}\n\n${b}`)
    expect(`${a}\n\n${b}`).toHaveLength(90)
  })

  it('drops a section heading left hanging at the end of the cut', () => {
    const text = `${'a'.repeat(40)}.\n\nLater years\n\n${'b'.repeat(60)}.`

    expect(trimToLimit(text, 70).text).toBe(`${'a'.repeat(40)}.`)
  })

  it('falls back to the last sentence end when the only paragraph break is too early', () => {
    const text = `Tiny.\n\n${'Word '.repeat(10).trim()}. ${'Other '.repeat(10).trim()}. ${'Last '.repeat(30).trim()}.`
    const firstSentence = `Tiny.\n\n${'Word '.repeat(10).trim()}.`
    const secondSentence = `${firstSentence} ${'Other '.repeat(10).trim()}.`

    const out = trimToLimit(text, secondSentence.length + 5)

    expect(out).toEqual({ text: secondSentence, trimmed: true })
  })

  it('falls back to the last space when there is no sentence end either', () => {
    expect(trimToLimit('alpha beta gamma delta', 13)).toEqual({ text: 'alpha beta', trimmed: true })
  })

  it('never exceeds the loader limit by default, which is half the paste limit', () => {
    const paragraph = `${'Word '.repeat(50).trim()}.`
    const text = Array.from({ length: 200 }, () => paragraph).join('\n\n')

    const out = trimToLimit(text)

    expect(out.trimmed).toBe(true)
    expect(LOADER_MAX_CHARS).toBe(10_000)
    expect(LOADER_MAX_CHARS).toBeLessThan(MAX_CHARS)
    expect(out.text.length).toBeLessThanOrEqual(LOADER_MAX_CHARS)
    expect(out.text.length).toBeGreaterThan(LOADER_MAX_CHARS - paragraph.length - 2)
    expect(out.text.endsWith(paragraph)).toBe(true)
  })
})

describe('buildArticle', () => {
  const page = (extract: string) => ({ kind: 'ok' as const, title: 'T', url: 'https://en.wikipedia.org/wiki/T', extract })

  it('returns the cleaned text with its length before trimming', () => {
    const body = 'Sentence here. '.repeat(30).trim()
    const article = buildArticle(page(`${body}\n\n== References ==\nignored`))

    expect(article).toEqual({ title: 'T', url: 'https://en.wikipedia.org/wiki/T', text: body, originalChars: body.length, trimmed: false })
  })

  it('reports a trimmed article with both lengths', () => {
    const paragraph = `${'Word '.repeat(100).trim()}.`
    const raw = Array.from({ length: 100 }, () => paragraph).join('\n')

    const article = buildArticle(page(raw))

    expect(article.trimmed).toBe(true)
    expect(article.originalChars).toBe(100 * paragraph.length + 99 * 2)
    expect(article.text.length).toBe(19 * paragraph.length + 18 * 2)
    expect(article.text.length).toBeLessThanOrEqual(LOADER_MAX_CHARS)
  })

  it('rejects an article under the minimum with a message that gives the length', () => {
    const short = 'x'.repeat(MIN_CHARS - 1)

    expect(() => buildArticle(page(short))).toThrow(WikiError)
    expect(() => buildArticle(page(short))).toThrow('"T" has only 199 characters of text. The analysis needs at least 200')
  })

  it('applies the minimum to the cleaned text, not the raw extract', () => {
    const raw = `Short intro.\n\n== References ==\n${'ref '.repeat(200)}`

    expect(() => buildArticle(page(raw))).toThrow(/only 12 characters/)
  })

  it('accepts exactly the minimum', () => {
    expect(buildArticle(page('y'.repeat(MIN_CHARS))).text).toHaveLength(MIN_CHARS)
  })
})
