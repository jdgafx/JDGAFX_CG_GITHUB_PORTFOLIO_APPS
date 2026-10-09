import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadArticle, searchTitles } from '../../src/lib/wikipedia-api'
import { WikiError } from '../../src/lib/wikipedia'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const body = 'A sentence about the topic that is long enough to count. '.repeat(10).trim()
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status })
const pageReply = (page: Record<string, unknown>): Response => json({ query: { pages: [page] } })

async function failure(promise: Promise<unknown>): Promise<WikiError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(WikiError)
  return err as WikiError
}

describe('loadArticle', () => {
  it('requests the extract URL and returns the cleaned article', async () => {
    const fetchMock = vi.fn(async () => pageReply({ title: 'Topic', fullurl: 'https://en.wikipedia.org/wiki/Topic', extract: body }))
    vi.stubGlobal('fetch', fetchMock)

    const article = await loadArticle(' Topic ')

    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(new URL(url).searchParams.get('titles')).toBe('Topic')
    expect(article).toEqual({ title: 'Topic', url: 'https://en.wikipedia.org/wiki/Topic', text: body, originalChars: body.length, trimmed: false })
  })

  it('reports a missing page as not found, naming the title asked for', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => pageReply({ title: 'Zzq', missing: true })))

    const error = await failure(loadArticle('Zzq'))

    expect(error.kind).toBe('not_found')
    expect(error.message).toBe('No Wikipedia article is titled "Zzq".')
    expect(error.retryable).toBe(false)
  })

  it('reports a disambiguation page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => pageReply({ title: 'Mercury', extract: 'Mercury may refer to:', pageprops: { disambiguation: '' } })))

    const error = await failure(loadArticle('Mercury'))

    expect(error.kind).toBe('disambiguation')
    expect(error.message).toContain('"Mercury" is a disambiguation page')
    expect(error.retryable).toBe(false)
  })

  it('reports a too-short article without a retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => pageReply({ title: 'Stub', extract: 'Tiny stub.' })))

    const error = await failure(loadArticle('Stub'))

    expect(error.kind).toBe('too_short')
    expect(error.retryable).toBe(false)
  })

  it('reports a network failure as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))

    const error = await failure(loadArticle('Topic'))

    expect(error.kind).toBe('network')
    expect(error.message).toBe('Could not reach Wikipedia. Check your connection and try again.')
    expect(error.retryable).toBe(true)
  })

  it('reports a non-200 status as unavailable, with the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 429)))

    const error = await failure(loadArticle('Topic'))

    expect(error.kind).toBe('unavailable')
    expect(error.message).toContain('status 429')
    expect(error.retryable).toBe(true)
  })

  it('reports an HTML or API-error reply as unreadable, not as a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html>', { status: 200 })))
    expect((await failure(loadArticle('Topic'))).kind).toBe('bad_response')

    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'badvalue' } })))
    expect((await failure(loadArticle('Topic'))).kind).toBe('bad_response')
  })

  it('times out with a retryable message when Wikipedia does not answer', async () => {
    const real = AbortSignal.timeout.bind(AbortSignal)
    const asked: number[] = []
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      asked.push(ms)
      return real(15)
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
      ),
    )

    const error = await failure(loadArticle('Topic'))

    expect(asked).toEqual([15_000])
    expect(error.kind).toBe('timeout')
    expect(error.retryable).toBe(true)
  })

  it('passes the caller\'s abort on as an abort, not as a Wikipedia error', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
      ),
    )

    const pending = loadArticle('Topic', controller.signal).catch((e: unknown) => e)
    controller.abort()

    const err = await pending
    expect(err).not.toBeInstanceOf(WikiError)
    expect((err as DOMException).name).toBe('AbortError')
  })
})

describe('searchTitles', () => {
  it('returns the matching titles', async () => {
    const fetchMock = vi.fn(async () => json({ query: { search: [{ title: 'Apollo 11' }, { title: 'Apollo program' }] } }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await searchTitles('apollo')).toEqual(['Apollo 11', 'Apollo program'])
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(new URL(url).searchParams.get('srsearch')).toBe('apollo')
  })

  it('throws a WikiError when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))

    expect((await failure(searchTitles('apollo'))).kind).toBe('network')
  })
})
