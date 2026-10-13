import { describe, expect, it } from 'vitest'
import { fetchFrontPage, storyOf } from '../../src/lib/hackerNews'

const item = (id: number, extra: Record<string, unknown> = {}) => ({ id, type: 'story', title: `Story ${id}`, url: `https://www.example.com/${id}`, score: 100 + id, descendants: id, ...extra })

function fakeFetch(ids: unknown, items: Record<number, unknown>, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/topstories.json')) return new Response(JSON.stringify(ids))
    const id = Number(/item\/(\d+)\.json$/.exec(url)?.[1])
    return id in items ? new Response(JSON.stringify(items[id])) : new Response('null', { status: 404 })
  }) as typeof fetch
}

describe('storyOf', () => {
  it('reads a story with its host, points and comments', () => {
    expect(storyOf(item(7))).toEqual({ id: 7, title: 'Story 7', href: 'https://www.example.com/7', host: 'example.com', score: 107, comments: 7 })
  })

  it('points a text post at its discussion', () => {
    expect(storyOf(item(8, { url: undefined }))).toMatchObject({ href: 'https://news.ycombinator.com/item?id=8', host: null })
  })

  it('refuses anything that is not a live story', () => {
    for (const bad of [null, 'x', [], item(1, { type: 'job' }), item(2, { dead: true }), item(3, { deleted: true }), item(4, { title: ' ' }), item(5, { id: 'x' })]) {
      expect(storyOf(bad)).toBeNull()
    }
  })

  it('never links a non-http address', () => {
    expect(storyOf(item(9, { url: 'javascript:alert(1)' }))).toMatchObject({ href: 'https://news.ycombinator.com/item?id=9', host: null })
  })
})

describe('fetchFrontPage', () => {
  it('returns the first ten stories in rank order, reading only the official API', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1)
    const calls: string[] = []
    const stories = await fetchFrontPage(fakeFetch(ids, Object.fromEntries(ids.map((id) => [id, item(id)])), calls))
    expect(stories.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(calls.every((url) => url.startsWith('https://hacker-news.firebaseio.com/v0/'))).toBe(true)
  })

  it('skips an item that cannot be read and fills from the spare ids', async () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    const items = Object.fromEntries(ids.filter((id) => id !== 3).map((id) => [id, item(id)]))
    const stories = await fetchFrontPage(fakeFetch(ids, items))
    expect(stories.map((s) => s.id)).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('throws when the list or every story is unreadable', async () => {
    await expect(fetchFrontPage(fakeFetch({ no: 'list' }, {}))).rejects.toThrow()
    await expect(fetchFrontPage(fakeFetch([1, 2], {}))).rejects.toThrow()
    await expect(fetchFrontPage((async () => new Response('', { status: 503 })) as typeof fetch)).rejects.toThrow()
  })
})
