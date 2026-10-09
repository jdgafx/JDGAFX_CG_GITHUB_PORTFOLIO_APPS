import { beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in for the @netlify/blobs module with the real contract: a refused conditional write RESOLVES with
// { modified: false } and does not throw, so an adapter that ignores the result would count a lost race as a win.
const calls: { name: string; consistency: string }[] = []
const values = new Map<string, string>()
const tags = new Map<string, string>()
let counter = 0
const put = (key: string, value: string) => {
  values.set(key, value)
  tags.set(key, `etag-${++counter}`)
}
vi.mock('@netlify/blobs', () => ({
  getStore: (options: { name: string; consistency: string }) => {
    calls.push(options)
    return {
      async get(key: string) {
        return values.has(key) ? (values.get(key) as string) : null
      },
      async getWithMetadata(key: string) {
        return values.has(key) ? { data: values.get(key) as string, etag: tags.get(key) } : null
      },
      async set(key: string, value: string, o: { onlyIfNew?: boolean; onlyIfMatch?: string } = {}) {
        if (o.onlyIfNew && values.has(key)) return { modified: false }
        if (o.onlyIfMatch !== undefined && tags.get(key) !== o.onlyIfMatch) return { modified: false }
        put(key, value)
        return { modified: true, etag: tags.get(key) }
      },
      async delete(key: string) {
        values.delete(key)
      },
      list() {
        return (async function* pages() {
          yield { blobs: [...values.keys()].map(key => ({ key })), directories: [] }
        })()
      },
    }
  },
}))

beforeEach(() => {
  calls.length = 0
  values.clear()
  tags.clear()
})

describe('Netlify Blobs adapter', () => {
  it('reports a lost conditional write as false, for setIfNew and for setIfMatch', async () => {
    const { createStore } = await import('../../netlify/shared/store')
    const { store, kind } = createStore()
    expect(kind).toBe('blobs')
    expect(await store.setIfNew('k', 'one')).toBe(true)
    expect(await store.setIfNew('k', 'two')).toBe(false)
    expect(await store.get('k')).toBe('one')
    const tagged = await store.getTagged('k')
    expect(await store.setIfMatch('k', 'three', 'stale')).toBe(false)
    expect(await store.setIfMatch('k', 'three', tagged?.etag ?? '')).toBe(true)
  })

  it('opens the store strongly consistent, and opens a new one for every request', async () => {
    const { activeStore } = await import('../../netlify/shared/store')
    activeStore()
    activeStore()
    expect(calls).toHaveLength(2)
    expect(calls.every(c => c.name === 'modelarena-arena' && c.consistency === 'strong')).toBe(true)
  })

  it('counts every one of many simultaneous ballots through the real adapter', async () => {
    const { createStore } = await import('../../netlify/shared/store')
    const { castBallot, readBoard } = await import('../../netlify/shared/arena')
    const { store } = createStore()
    const entries = [{ model: 'a', served: null }, { model: 'b', served: null }]
    const expiry = Date.now() + 60_000
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        castBallot(store, 'blobs', { runId: `${expiry}-00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, entries, outcome: { winner: i % 2 }, tie: false }, 1_000 + i),
      ),
    )
    expect(results.every(r => r.kind === 'counted')).toBe(true)
    expect((await readBoard(store, 'blobs')).ballots).toBe(20)
  })
})
