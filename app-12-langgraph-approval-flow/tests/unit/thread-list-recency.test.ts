import { describe, expect, it, vi } from 'vitest'
import { createMemoryStore, StoreTimeoutError, type KeyValueStore } from '../../netlify/shared/store'
import { listThreadsDetailed, MAX_LISTED_THREADS, newThreadId, UPDATED_PREFIX, updatedKey, writeThread } from '../../netlify/shared/thread-index'

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 9, 0, minutes))
const change = (id: string, status: 'completed' | 'awaiting_approval' = 'completed') => ({
  id,
  title: `acme/widgets #1: ${id}`,
  repo: 'acme/widgets',
  number: 1,
  status,
  priority: null,
})

describe('the list picks by update time', () => {
  it('lists an old thread that was updated last, even when more than 50 newer threads exist', async () => {
    const store = createMemoryStore()
    const old = newThreadId(at(0))
    await writeThread(store, change(old, 'awaiting_approval'), at(0))
    const newer = Array.from({ length: MAX_LISTED_THREADS + 5 }, (_, i) => newThreadId(at(i + 1)))
    for (const [i, id] of newer.entries()) await writeThread(store, change(id), at(i + 1))
    // The maintainer answers the old thread an hour after the newest one was created.
    await writeThread(store, change(old), at(200))

    const { rows } = await listThreadsDetailed(store)

    expect(rows).toHaveLength(MAX_LISTED_THREADS)
    expect(rows[0]).toMatchObject({ id: old, updatedAt: at(200).toISOString() })
    expect(rows.map((r) => r.updatedAt)).toEqual([...rows.map((r) => r.updatedAt)].sort().reverse())
    // The oldest-updated threads are the ones that fall off, not the thread that was just updated.
    expect(rows.some((r) => r.id === newer[0])).toBe(false)
    expect(rows.some((r) => r.id === newer.at(-1))).toBe(true)
  })

  it('leaves one recency marker per thread: each write removes the one before it', async () => {
    const store = createMemoryStore()
    const id = newThreadId(at(0))
    for (const minute of [0, 5, 9]) await writeThread(store, change(id), at(minute))
    expect(await store.list(UPDATED_PREFIX)).toEqual([updatedKey(id, at(9))])
  })

  it('still lists threads that were saved before markers existed, after the ones that have markers', async () => {
    const store = createMemoryStore()
    const legacy = newThreadId(at(0))
    const marked = newThreadId(at(1))
    await store.set(`threads/${legacy}`, JSON.stringify({ ...change(legacy), updatedAt: at(0).toISOString() }))
    await writeThread(store, change(marked), at(1))
    expect((await listThreadsDetailed(store)).rows.map((r) => r.id)).toEqual([marked, legacy])
  })

  it('keeps listing when the markers cannot be read', async () => {
    const store = createMemoryStore()
    const id = newThreadId(at(0))
    await writeThread(store, change(id), at(0))
    const broken: KeyValueStore = { ...store, list: async (prefix) => (prefix === UPDATED_PREFIX ? Promise.reject(new Error('down')) : store.list(prefix)) }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await listThreadsDetailed(broken)).rows.map((r) => r.id)).toEqual([id])
  })
})

describe('a summary read that times out is tried once more', () => {
  async function seeded() {
    const store = createMemoryStore()
    const ids = [newThreadId(at(1)), newThreadId(at(2)), newThreadId(at(3))]
    for (const [i, id] of ids.entries()) await writeThread(store, change(id), at(i + 1))
    return { store, ids }
  }

  it('keeps the row when the second read answers', async () => {
    const { store, ids } = await seeded()
    const slow = `threads/${ids[1]}`
    let reads = 0
    const flaky: KeyValueStore = {
      ...store,
      get: async (key) => {
        if (key === slow && (reads += 1) === 1) throw new StoreTimeoutError()
        return store.get(key)
      },
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { rows } = await listThreadsDetailed(flaky)

    expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort())
    expect(reads).toBe(2)
  })

  it('tries only once more: a second timeout costs the row, not the list', async () => {
    const { store, ids } = await seeded()
    const slow = `threads/${ids[1]}`
    let reads = 0
    const stuck: KeyValueStore = {
      ...store,
      get: async (key) => {
        if (key === slow) {
          reads += 1
          throw new StoreTimeoutError()
        }
        return store.get(key)
      },
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { rows } = await listThreadsDetailed(stuck)

    expect(reads).toBe(2)
    expect(rows.map((r) => r.id).sort()).toEqual([ids[0], ids[2]].sort())
  })

  it('does not retry a read that failed for another reason', async () => {
    const { store, ids } = await seeded()
    const bad = `threads/${ids[0]}`
    let reads = 0
    const failing: KeyValueStore = {
      ...store,
      get: async (key) => {
        if (key === bad) {
          reads += 1
          throw new Error('corrupt')
        }
        return store.get(key)
      },
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await listThreadsDetailed(failing)
    expect(reads).toBe(1)
  })
})
