import { afterEach, describe, expect, it, vi } from 'vitest'
import { stripPageMarkers } from '../../src/lib/chunk'
import { buildDocument } from '../../src/lib/document'
import {
  buildExtractUrl,
  buildSearchUrl,
  fetchArticle,
  parseExtract,
  parseSuggestions,
  searchTitles,
  sectionsToPages,
  WikipediaError,
} from '../../src/lib/wikipedia'

// The shape of a real extract: a lead, "== Heading ==" lines, empty parent headings, then back matter.
const EXTRACT = [
  'Photosynthesis is a system of biological processes. It converts light energy into chemical energy.',
  '',
  '',
  '== Overview ==',
  'Photosynthesis changes light energy into chemical energy stored in sugars.',
  '',
  '',
  '== Light-dependent reactions ==',
  '',
  '=== Z scheme ===',
  'In the Z scheme, electrons move from water to NADP+.',
  '',
  '== See also ==',
  '',
  '== References ==',
  '',
  '=== Cited works ===',
  'A citation that must not reach the model.',
  '== Further reading ==',
  '=== Books ===',
  'A book that must not reach the model.',
].join('\n')

describe('buildSearchUrl and buildExtractUrl', () => {
  it('asks the English Wikipedia API for article titles, cross-origin', () => {
    expect(buildSearchUrl(' photosyn ')).toBe(
      'https://en.wikipedia.org/w/api.php?action=opensearch&search=photosyn&namespace=0&limit=6&format=json&origin=*',
    )
  })

  it('encodes what the person typed instead of splicing it into the URL', () => {
    const url = new URL(buildSearchUrl('a&b=c d'))
    expect(url.searchParams.get('search')).toBe('a&b=c d')
    expect(url.searchParams.get('action')).toBe('opensearch')
    expect(url.hostname).toBe('en.wikipedia.org')
  })

  it('asks for the plain-text extract with headings, redirects followed and the canonical URL', () => {
    const url = new URL(buildExtractUrl('Apollo 11'))
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: 'query',
      prop: 'extracts|info',
      explaintext: '1',
      exsectionformat: 'wiki',
      redirects: '1',
      inprop: 'url',
      titles: 'Apollo 11',
      formatversion: '2',
      format: 'json',
      origin: '*',
    })
  })
})

describe('parseSuggestions', () => {
  it('reads the title list of an opensearch reply', () => {
    const reply = ['photosyn', ['Photosynthesis', 'Photosynthetic efficiency'], ['', ''], ['https://a', 'https://b']]
    expect(parseSuggestions(reply)).toEqual(['Photosynthesis', 'Photosynthetic efficiency'])
  })

  it('returns no titles for a reply of any other shape', () => {
    expect(parseSuggestions({})).toEqual([])
    expect(parseSuggestions(['q', 'not a list'])).toEqual([])
    expect(parseSuggestions(['q', ['ok', 4, '']])).toEqual(['ok'])
  })
})

describe('parseExtract', () => {
  const page = { title: 'Photosynthesis', extract: 'Text.', canonicalurl: 'https://en.wikipedia.org/wiki/Photosynthesis' }

  it('reads the title, the canonical URL and the extract', () => {
    expect(parseExtract({ query: { pages: [page] } }, 'photosynthesis')).toEqual({
      title: 'Photosynthesis',
      url: 'https://en.wikipedia.org/wiki/Photosynthesis',
      extract: 'Text.',
    })
  })

  it('names the title the person asked for when the page is missing', () => {
    const missing = { query: { pages: [{ title: 'Zzqx', missing: true }] } }
    expect(() => parseExtract(missing, ' Zzqx ')).toThrow(new WikipediaError('Wikipedia has no article titled "Zzqx".'))
  })

  it('refuses a page with no text, such as an empty reply', () => {
    expect(() => parseExtract({ query: { pages: [{ ...page, extract: '  ' }] } }, 'x')).toThrow(/has no text to read/)
    expect(() => parseExtract({}, 'x')).toThrow(/no article titled/)
  })
})

describe('sectionsToPages', () => {
  it('numbers the lead and each heading with text, and titles nested ones with their parent', () => {
    const { text, sectionTitles, truncated } = sectionsToPages(EXTRACT, 'Photosynthesis')
    expect(sectionTitles).toEqual(['Photosynthesis', 'Overview', 'Light-dependent reactions > Z scheme'])
    expect(truncated).toBe(false)
    expect(text).toBe(
      [
        '--- Page 1 ---\nPhotosynthesis\nPhotosynthesis is a system of biological processes. It converts light energy into chemical energy.',
        '--- Page 2 ---\nOverview\nPhotosynthesis changes light energy into chemical energy stored in sugars.',
        '--- Page 3 ---\nZ scheme\nIn the Z scheme, electrons move from water to NADP+.',
      ].join('\n\n'),
    )
  })

  it('drops back matter and everything nested under it', () => {
    const { text } = sectionsToPages(EXTRACT, 'Photosynthesis')
    expect(text).not.toContain('citation')
    expect(text).not.toContain('book')
    expect(text).not.toContain('See also')
  })

  it('resumes at the next section that is not back matter', () => {
    const extract = 'Lead text.\n== Notes ==\nA note.\n=== Sub ===\nNested note.\n== Legacy ==\nIt lasted.'
    expect(sectionsToPages(extract, 'Topic').sectionTitles).toEqual(['Topic', 'Legacy'])
  })

  it('leaves out the lead when the article has no text before its first heading', () => {
    expect(sectionsToPages('== History ==\nLong ago.', 'Topic').sectionTitles).toEqual(['History'])
  })

  it('stops before the section that would pass the size cap, and says so', () => {
    const extract = `Lead text.\n== One ==\n${'a'.repeat(100)}\n== Two ==\n${'b'.repeat(100)}`
    const capped = sectionsToPages(extract, 'Topic', 150)
    expect(capped.sectionTitles).toEqual(['Topic', 'One'])
    expect(capped.truncated).toBe(true)
    expect(capped.text).not.toContain('bbb')
  })

  it('removes a page marker from the article itself, so it cannot fake a section', () => {
    const { text, sectionTitles } = sectionsToPages('Lead --- Page 9 --- text.', 'Topic')
    expect(sectionTitles).toEqual(['Topic'])
    expect(text.match(/--- Page \d+ ---/g)).toEqual(['--- Page 1 ---'])
  })

  it('returns no sections for an extract with only back matter', () => {
    expect(sectionsToPages('== References ==\nA citation.', 'Topic').sectionTitles).toEqual([])
  })
})

describe('buildDocument with sections', () => {
  it('maps each passage to the section it starts in', () => {
    const body = (word: string) => `${word} `.repeat(150).trim()
    const extract = `${body('alpha')}\n== Two ==\n${body('beta')}\n== Three ==\n${body('gamma')}`
    const sections = sectionsToPages(extract, 'Topic')
    const doc = buildDocument({
      title: 'Topic',
      source: { label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Topic' },
      text: sections.text,
      unit: 'section',
      pages: sections.sectionTitles.length,
      sectionTitles: sections.sectionTitles,
    })
    expect(doc.pages).toBe(3)
    expect(doc.unit).toBe('section')
    expect(doc.chunkPages).toHaveLength(doc.chunks.length)
    expect([...new Set(doc.chunkPages)]).toEqual([1, 2, 3])
    // Passages are in document order, so the section numbers never go backwards.
    expect(doc.chunkPages).toEqual([...doc.chunkPages].sort((a, b) => a - b))
    const firstOfThree = doc.chunks[doc.chunkPages.indexOf(3)] ?? ''
    expect(firstOfThree).toMatch(/gamma|Three/)
    expect(doc.charCount).toBe(stripPageMarkers(sections.text).length)
  })
})

describe('fetching from Wikipedia', () => {
  afterEach(() => vi.unstubAllGlobals())

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  it('searches titles through the API URL and returns them', async () => {
    const mock = vi.fn(async () => jsonResponse(['ph', ['Photosynthesis', 'Phosphorus'], [], []]))
    vi.stubGlobal('fetch', mock)
    expect(await searchTitles('ph')).toEqual(['Photosynthesis', 'Phosphorus'])
    expect((mock.mock.calls[0] as unknown as [string])[0]).toBe(buildSearchUrl('ph'))
  })

  it('does not call the API for an empty search', async () => {
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    expect(await searchTitles('   ')).toEqual([])
    expect(mock).not.toHaveBeenCalled()
  })

  it('fetches an article and returns its canonical title, link and sections', async () => {
    const mock = vi.fn(async () =>
      jsonResponse({ query: { pages: [{ title: 'Photosynthesis', extract: EXTRACT, canonicalurl: 'https://en.wikipedia.org/wiki/Photosynthesis' }] } }),
    )
    vi.stubGlobal('fetch', mock)
    const article = await fetchArticle('photosynthesis')
    expect(article.title).toBe('Photosynthesis')
    expect(article.url).toBe('https://en.wikipedia.org/wiki/Photosynthesis')
    expect(article.sectionTitles).toHaveLength(3)
    expect(new URL((mock.mock.calls[0] as unknown as [string])[0]).searchParams.get('titles')).toBe('photosynthesis')
  })

  it('refuses an article whose text is all back matter', async () => {
    const page = { title: 'Lists', extract: '== References ==\nA citation.' }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ query: { pages: [page] } })))
    await expect(fetchArticle('Lists')).rejects.toThrow(/has no text to read/)
  })

  it('turns a network failure, a server error and an unreadable reply into plain sentences', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(fetchArticle('x')).rejects.toThrow('Could not reach Wikipedia. Check your connection and try again.')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    await expect(fetchArticle('x')).rejects.toThrow('Wikipedia answered with an error (503). Try again shortly.')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })))
    await expect(fetchArticle('x')).rejects.toThrow('Wikipedia returned a reply that could not be read. Try again.')
  })

  it('passes on the caller abort so a stale search can be cancelled', async () => {
    let seen: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined
      return jsonResponse(['q', [], [], []])
    }))
    const caller = new AbortController()
    await searchTitles('q', caller.signal)
    expect(seen?.aborted).toBe(false)
    caller.abort()
    expect(seen?.aborted).toBe(true)
  })

  it('rethrows the caller abort as it is, not as a Wikipedia failure', async () => {
    const caller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => {
      caller.abort()
      throw new DOMException('aborted', 'AbortError')
    }))
    await expect(searchTitles('q', caller.signal)).rejects.not.toBeInstanceOf(WikipediaError)
  })
})
