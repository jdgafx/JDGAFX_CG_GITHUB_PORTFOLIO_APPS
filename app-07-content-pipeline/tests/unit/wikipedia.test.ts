import { describe, expect, it, vi } from 'vitest'
import { fetchLead, leadFrom, searchKey } from '../../src/lib/wikipedia'

const summary = {
  type: 'standard',
  title: 'Rust (programming language)',
  description: 'General-purpose programming language',
  extract: 'Rust is a general-purpose programming language.',
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Rust_(programming_language)' } },
  thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Rust.png' },
  timestamp: '2026-10-12T08:30:00Z',
}

describe('searchKey', () => {
  it('takes the key of the first match', () => {
    expect(searchKey({ pages: [{ key: 'Rust_(programming_language)' }, { key: 'Other' }] })).toBe('Rust_(programming_language)')
  })

  it('is null when nothing matched or the reply is not a search reply', () => {
    expect(searchKey({ pages: [] })).toBeNull()
    expect(searchKey({})).toBeNull()
    expect(searchKey(null)).toBeNull()
  })
})

describe('leadFrom', () => {
  it('reads a plain article', () => {
    expect(leadFrom(summary)).toEqual({
      title: 'Rust (programming language)',
      description: 'General-purpose programming language',
      extract: 'Rust is a general-purpose programming language.',
      url: 'https://en.wikipedia.org/wiki/Rust_(programming_language)',
      image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Rust.png',
      edited: '2026-10-12',
    })
  })

  it('drops an image that is not on a Wikimedia image host', () => {
    expect(leadFrom({ ...summary, thumbnail: { source: 'https://evil.example/x.png' } })?.image).toBeNull()
    expect(leadFrom({ ...summary, thumbnail: undefined, timestamp: undefined })).toMatchObject({ image: null, edited: null })
  })

  it('refuses a disambiguation page, an empty extract and a link that is not on en.wikipedia.org', () => {
    expect(leadFrom({ ...summary, type: 'disambiguation' })).toBeNull()
    expect(leadFrom({ ...summary, extract: ' ' })).toBeNull()
    expect(leadFrom({ ...summary, content_urls: { desktop: { page: 'https://evil.example/x' } } })?.url).toBe('https://en.wikipedia.org/wiki/Rust_(programming_language)')
  })
})

describe('fetchLead', () => {
  it('searches, then reads the summary of the first match, sending no model request', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return new Response(JSON.stringify(String(input).includes('/search/') ? { pages: [{ key: 'Rust_(programming_language)' }] } : summary), { status: 200 })
    }) as unknown as typeof fetch
    const lead = await fetchLead('The Rust programming language', new AbortController().signal, fetchImpl)
    expect(lead.title).toBe('Rust (programming language)')
    expect(urls).toHaveLength(2)
    expect(urls.every(url => url.startsWith('https://en.wikipedia.org/'))).toBe(true)
  })

  it('throws when Wikipedia answers with an error', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch
    await expect(fetchLead('x', new AbortController().signal, fetchImpl)).rejects.toThrow()
  })
})
