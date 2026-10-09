import { describe, expect, it, vi } from 'vitest'
import { createMemoryStore, StoreTimeoutError, type KeyValueStore } from '../../netlify/shared/store'
import {
  describeError,
  getThreadEntry,
  LEGACY_INDEX_KEY,
  listThreads,
  MAX_LISTED_THREADS,
  newThreadId,
  startsWithTime,
  titleFor,
  WAITING_PREFIX,
  writeThread,
} from '../../netlify/shared/thread-index'
import { threadIdFrom } from '../../netlify/shared/guard'
import { issue } from '../helpers/issues'

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 9, 0, minutes))
const row = (id: string, status: 'awaiting_approval' | 'completed' | 'failed' = 'completed') => ({
  id,
  title: `acme/widgets #1: ${id}`,
  repo: 'acme/widgets',
  number: 1,
  status,
  priority: null,
})

/** A store whose every call waits a random few milliseconds, so concurrent callers really interleave. */
function jittery(inner: KeyValueStore): KeyValueStore {
  const wait = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 15))
  return {
    ...inner,
    get: async (key) => (await wait(), inner.get(key)),
    set: async (key, value) => (await wait(), inner.set(key, value)),
    delete: async (key) => (await wait(), inner.delete(key)),
    list: async (prefix) => (await wait(), inner.list(prefix)),
  }
}

describe('newThreadId', () => {
  it('is a UUID the thread id check accepts, with the time in its first 48 bits', () => {
    const id = newThreadId(new Date('2026-10-09T12:00:00.000Z'))
    expect(threadIdFrom(id)).toBe(id)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const millis = parseInt(id.replace(/-/g, '').slice(0, 12), 16)
    expect(new Date(millis).toISOString()).toBe('2026-10-09T12:00:00.000Z')
  })

  it('sorts by creation time, and two ids made in the same millisecond differ', () => {
    const ids = [at(5), at(1), at(9), at(3)].map((time) => newThreadId(time))
    expect([...ids].sort()).toEqual([ids[1], ids[3], ids[0], ids[2]])
    expect(newThreadId(at(1))).not.toBe(newThreadId(at(1)))
  })
})

describe('thread summaries: one blob per thread', () => {
  it('keeps every row when ten runs write their own summary at the same moment', async () => {
    const store = jittery(createMemoryStore())
    const ids = Array.from({ length: 10 }, (_, i) => newThreadId(at(i)))

    await Promise.all(ids.map((id, i) => writeThread(store, row(id, 'awaiting_approval'), at(i))))

    const listed = await listThreads(store)
    expect(listed.map((entry) => entry.id)).toEqual([...ids].reverse())
    expect(listed.every((entry) => entry.status === 'awaiting_approval')).toBe(true)
  })

  it('keeps every row when several threads change status at the same moment', async () => {
    const store = jittery(createMemoryStore())
    const ids = Array.from({ length: 10 }, (_, i) => newThreadId(at(i)))
    await Promise.all(ids.map((id, i) => writeThread(store, row(id, 'awaiting_approval'), at(i))))

    await Promise.all(ids.map((id, i) => writeThread(store, row(id, i % 2 === 0 ? 'completed' : 'failed'), at(30 + i))))

    const byId = new Map((await listThreads(store)).map((entry) => [entry.id, entry.status]))
    expect(byId.size).toBe(10)
    ids.forEach((id, i) => expect(byId.get(id)).toBe(i % 2 === 0 ? 'completed' : 'failed'))
  })

  it('replaces a thread summary in place and stamps it', async () => {
    const store = createMemoryStore()
    const id = newThreadId(at(0))
    await writeThread(store, row(id, 'awaiting_approval'), at(1))
    const entry = await writeThread(store, { ...row(id, 'completed'), priority: 'high' }, at(2))
    expect(entry.updatedAt).toBe('2026-10-09T00:02:00.000Z')
    expect(await listThreads(store)).toEqual([entry])
    expect(await getThreadEntry(store, id)).toEqual(entry)
  })

  it('lists the newest first and shows at most 50, however many were saved', async () => {
    const store = createMemoryStore()
    const ids = Array.from({ length: 60 }, (_, i) => newThreadId(at(i)))
    for (const [i, id] of ids.entries()) await writeThread(store, row(id), at(i))

    const listed = await listThreads(store)
    expect(MAX_LISTED_THREADS).toBe(50)
    expect(listed).toHaveLength(50)
    expect(listed[0].id).toBe(ids[59])
    expect(listed.at(-1)?.id).toBe(ids[10])
    expect(listed.some((entry) => entry.id === ids[9])).toBe(false)
  })

  it('reads only the newest 50 summaries, not all of them', async () => {
    const inner = createMemoryStore()
    const ids = Array.from({ length: 60 }, (_, i) => newThreadId(at(i)))
    for (const [i, id] of ids.entries()) await writeThread(inner, row(id), at(i))
    let reads = 0
    const counting: KeyValueStore = { ...inner, get: (key) => (key.startsWith('threads/') && key !== LEGACY_INDEX_KEY ? (reads += 1, inner.get(key)) : inner.get(key)) }
    await listThreads(counting)
    expect(reads).toBe(50)
  })

  it('skips a summary that is damaged or of another shape, and keeps the rest', async () => {
    const store = createMemoryStore()
    const good = newThreadId(at(1))
    await writeThread(store, row(good), at(1))
    await store.set(`threads/${newThreadId(at(2))}`, '{not json')
    await store.set(`threads/${newThreadId(at(3))}`, JSON.stringify({ id: 'x', status: 'unknown' }))
    expect((await listThreads(store)).map((entry) => entry.id)).toEqual([good])
  })

  it('does not list the legacy index key as a thread', async () => {
    const store = createMemoryStore()
    await store.set(LEGACY_INDEX_KEY, '[]')
    expect(await listThreads(store)).toEqual([])
  })
})

describe('the single index document of earlier versions', () => {
  const REFUND_ROW = {
    id: '3f2b6c1e-9a4d-4e8f-8b7a-1c2d3e4f5a6b',
    title: 'I was charged twice for ORD-1042',
    status: 'awaiting_approval',
    updatedAt: '2026-10-08T12:00:00.000Z',
    amount: 129,
  }
  const OLD_NEW_SHAPE = {
    id: '9d1c1d3a-0f4e-4c58-9a57-2f1d6b7e8a90',
    title: 'acme/widgets #101: How do I configure the proxy?',
    repo: 'acme/widgets',
    number: 101,
    status: 'awaiting_approval',
    updatedAt: '2026-10-09T09:00:00.000Z',
    priority: 'high',
  }

  it('is read as a fallback: a thread only the old index knows is listed, and a refund row is skipped', async () => {
    const store = createMemoryStore()
    await store.set(LEGACY_INDEX_KEY, JSON.stringify([REFUND_ROW, OLD_NEW_SHAPE, { id: 5 }, null]))
    expect(await listThreads(store)).toEqual([OLD_NEW_SHAPE])
    expect(await getThreadEntry(store, OLD_NEW_SHAPE.id)).toEqual(OLD_NEW_SHAPE)
    expect(await getThreadEntry(store, REFUND_ROW.id)).toBeUndefined()
  })

  it('is merged with the summaries by time, and a summary wins over the old row for the same thread', async () => {
    const store = createMemoryStore()
    await store.set(LEGACY_INDEX_KEY, JSON.stringify([OLD_NEW_SHAPE]))
    const fresh = newThreadId(at(0))
    await writeThread(store, row(fresh), new Date('2026-10-09T10:00:00Z'))
    await writeThread(store, { ...row(OLD_NEW_SHAPE.id, 'completed'), repo: 'acme/widgets', number: 101 }, new Date('2026-10-09T11:00:00Z'))

    const listed = await listThreads(store)
    expect(listed.map((entry) => [entry.id, entry.status])).toEqual([
      [OLD_NEW_SHAPE.id, 'completed'],
      [fresh, 'completed'],
    ])
  })

  it('is never written again', async () => {
    const store = createMemoryStore()
    await store.set(LEGACY_INDEX_KEY, JSON.stringify([OLD_NEW_SHAPE]))
    await writeThread(store, row(newThreadId(at(0))), at(0))
    expect(await store.get(LEGACY_INDEX_KEY)).toBe(JSON.stringify([OLD_NEW_SHAPE]))
  })

  it('reads a damaged old index as empty', async () => {
    const store = createMemoryStore()
    await store.set(LEGACY_INDEX_KEY, '{not json')
    expect(await listThreads(store)).toEqual([])
  })
})

describe('titleFor', () => {
  it('joins repo, number and title on one line', () => {
    expect(titleFor(issue({ number: 12, title: 'Crash on\nstart' }))).toBe('acme/widgets #12: Crash on start')
  })

  it('cuts a long title to 70 characters ending in three dots', () => {
    const title = titleFor(issue({ title: 'word '.repeat(40) }))
    expect(title).toHaveLength(70)
    expect(title.endsWith('...')).toBe(true)
  })
})


describe('listing survives a failing store', () => {
  async function seeded(count: number) {
    const store = createMemoryStore()
    const ids = Array.from({ length: count }, (_, i) => newThreadId(at(i)))
    for (const [i, id] of ids.entries()) await writeThread(store, row(id), at(i))
    return { store, ids }
  }

  it('skips a summary whose read throws, keeps the other rows, and logs the key and the cause', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store, ids } = await seeded(5)
    const flaky: KeyValueStore = {
      ...store,
      get: (key) => (key === `threads/${ids[2]}` ? Promise.reject(new Error('blobs 503', { cause: new Error('upstream reset') })) : store.get(key)),
    }

    const listed = await listThreads(flaky)

    expect(listed.map((entry) => entry.id)).toEqual([ids[4], ids[3], ids[1], ids[0]])
    const logged = error.mock.calls.map((call) => String(call[0])).join('\n')
    expect(logged).toContain(`could not read the thread summary threads/${ids[2]}`)
    expect(logged).toContain('Error: blobs 503 <- Error: upstream reset')
    error.mockRestore()
  })

  it('throws the first error when every read fails, so a store that is down does not read as an empty list', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store } = await seeded(4)
    const down: KeyValueStore = { ...store, get: () => Promise.reject(new StoreTimeoutError()) }
    await expect(listThreads(down)).rejects.toBeInstanceOf(StoreTimeoutError)
    error.mockRestore()
  })

  it('logs a failed key listing distinctly and rethrows it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store } = await seeded(1)
    const noList: KeyValueStore = { ...store, list: () => Promise.reject(new Error('list failed')) }
    await expect(listThreads(noList)).rejects.toThrow('list failed')
    expect(String(error.mock.calls[0][0])).toContain('could not list the thread summaries')
    error.mockRestore()
  })

  it('shows the list without the legacy rows when the legacy index cannot be read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store, ids } = await seeded(3)
    const noLegacy: KeyValueStore = { ...store, get: (key) => (key === LEGACY_INDEX_KEY ? Promise.reject(new Error('legacy read failed')) : store.get(key)) }
    expect((await listThreads(noLegacy)).map((entry) => entry.id)).toEqual([ids[2], ids[1], ids[0]])
    expect(String(error.mock.calls[0][0])).toContain('could not read the legacy thread index')
    error.mockRestore()
  })

  it('reads at most 8 summaries at a time, however many threads are listed', async () => {
    const { store } = await seeded(50)
    let running = 0
    let peak = 0
    const counting: KeyValueStore = {
      ...store,
      get: async (key) => {
        if (!key.startsWith('threads/')) return store.get(key)
        running += 1
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, 2))
        running -= 1
        return store.get(key)
      },
    }
    expect(await listThreads(counting)).toHaveLength(50)
    expect(peak).toBeLessThanOrEqual(8)
    expect(peak).toBeGreaterThan(1)
  })

  it('returns the rows read so far when the time budget runs out', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
      const { store } = await seeded(30)
      const slow: KeyValueStore = {
        ...store,
        get: async (key) => {
          vi.setSystemTime(Date.now() + 2_000)
          return store.get(key)
        },
      }
      const listed = await listThreads(slow)
      expect(listed.length).toBeGreaterThan(0)
      expect(listed.length).toBeLessThan(30)
      expect(error.mock.calls.some((call) => String(call[0]).includes('ran out of time'))).toBe(true)
    } finally {
      vi.useRealTimers()
      error.mockRestore()
    }
  })
})

describe('which threads the list shows', () => {
  it('lists a waiting thread first even when it is older than 50 finished ones', async () => {
    const store = createMemoryStore()
    const oldWaiting = newThreadId(at(0))
    await writeThread(store, row(oldWaiting, 'awaiting_approval'), at(0))
    for (let i = 1; i <= 60; i += 1) await writeThread(store, row(newThreadId(at(i))), at(i))

    const listed = await listThreads(store)

    expect(listed).toHaveLength(50)
    expect(listed[0]).toMatchObject({ id: oldWaiting, status: 'awaiting_approval' })
  })

  it('puts every waiting thread ahead of the finished ones, each group newest first', async () => {
    const store = createMemoryStore()
    const a = newThreadId(at(1))
    const b = newThreadId(at(2))
    const c = newThreadId(at(3))
    await writeThread(store, row(a, 'awaiting_approval'), at(10))
    await writeThread(store, row(b), at(11))
    await writeThread(store, row(c, 'awaiting_approval'), at(12))
    expect((await listThreads(store)).map((entry) => entry.id)).toEqual([c, a, b])
  })

  it('keeps a waiting marker only while the thread waits', async () => {
    const store = createMemoryStore()
    const id = newThreadId(at(0))
    await writeThread(store, row(id, 'awaiting_approval'), at(1))
    expect(await store.list(WAITING_PREFIX)).toEqual([`${WAITING_PREFIX}${id}`])
    await writeThread(store, row(id, 'completed'), at(2))
    expect(await store.list(WAITING_PREFIX)).toEqual([])
  })

  it('still lists a thread whose waiting marker was lost, by recency', async () => {
    const store = createMemoryStore()
    const id = newThreadId(at(0))
    await writeThread(store, row(id, 'awaiting_approval'), at(1))
    await store.delete(`${WAITING_PREFIX}${id}`)
    expect((await listThreads(store)).map((entry) => entry.id)).toEqual([id])
  })

  it('keeps a thread listed when its waiting marker cannot be written, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const inner = createMemoryStore()
    const noMarkers: KeyValueStore = { ...inner, set: (key, value) => (key.startsWith(WAITING_PREFIX) ? Promise.reject(new Error('marker down')) : inner.set(key, value)) }
    const id = newThreadId(at(0))
    await writeThread(noMarkers, row(id, 'awaiting_approval'), at(1))
    expect((await listThreads(inner)).map((entry) => entry.id)).toEqual([id])
    expect(String(error.mock.calls[0][0])).toContain(`could not update the waiting marker of thread ${id}`)
    error.mockRestore()
  })
})

describe('threads whose random id does not start with the time', () => {
  const RANDOM_ID = '3fba3d5e-61c2-4a55-9d3f-8b1e2f4a6c70'
  const OTHER_RANDOM = 'b715c0de-2f4b-4e11-8a90-0c3d5e7f9a12'

  it('are told apart from time-ordered ids', () => {
    expect(startsWithTime(newThreadId())).toBe(true)
    expect(startsWithTime(RANDOM_ID)).toBe(false)
  })

  it('get a time-ordered key, are found again by id, and keep that key when they change status', async () => {
    const store = createMemoryStore()
    await writeThread(store, row(RANDOM_ID, 'awaiting_approval'), new Date('2026-10-09T10:00:00Z'))
    const [key] = (await store.list('threads/')).filter((k) => k !== LEGACY_INDEX_KEY)
    expect(key).toMatch(/^threads\/[0-9a-f]{8}-[0-9a-f]{4}-3fba3d5e-61c2-4a55-9d3f-8b1e2f4a6c70$/)
    expect((await getThreadEntry(store, RANDOM_ID))?.status).toBe('awaiting_approval')

    await writeThread(store, row(RANDOM_ID, 'completed'), new Date('2026-10-09T11:00:00Z'))
    expect((await store.list('threads/')).filter((k) => k !== LEGACY_INDEX_KEY)).toEqual([key])
    expect((await getThreadEntry(store, RANDOM_ID))?.status).toBe('completed')
  })

  it('do not push newer threads off the list: the 50 newest by key are read, whatever their ids look like', async () => {
    const store = createMemoryStore()
    // Twenty random-id threads first seen long ago, then 40 new threads.
    const old = Array.from({ length: 20 }, (_, i) => `${(0xb7 + i).toString(16)}15c0de-2f4b-4e11-8a90-0c3d5e7f9a${i.toString(16).padStart(2, '0')}`)
    for (const [i, id] of old.entries()) await writeThread(store, row(id), new Date(Date.UTC(2026, 8, 1, 0, i)))
    const fresh = Array.from({ length: 40 }, (_, i) => newThreadId(at(i)))
    for (const [i, id] of fresh.entries()) await writeThread(store, row(id), at(i))

    const listed = await listThreads(store)

    expect(listed).toHaveLength(50)
    for (const id of fresh) expect(listed.some((entry) => entry.id === id)).toBe(true)
    expect(listed.filter((entry) => old.includes(entry.id))).toHaveLength(10)
  })

  it('are listed by the legacy fallback without a summary, and then by their summary once one is written', async () => {
    const store = createMemoryStore()
    const legacyRow = { ...row(OTHER_RANDOM, 'awaiting_approval'), updatedAt: '2026-10-08T00:00:00.000Z' }
    await store.set(LEGACY_INDEX_KEY, JSON.stringify([legacyRow]))
    expect((await listThreads(store)).map((entry) => entry.status)).toEqual(['awaiting_approval'])
    await writeThread(store, row(OTHER_RANDOM, 'completed'), at(5))
    const listed = await listThreads(store)
    expect(listed).toHaveLength(1)
    expect(listed[0].status).toBe('completed')
  })
})

describe('describeError', () => {
  it('shows the error, its cause, and a value that is not an error', () => {
    expect(describeError(new Error('outer', { cause: new Error('inner') }))).toBe('Error: outer <- Error: inner')
    expect(describeError('plain')).toBe('plain')
    expect(describeError(new StoreTimeoutError())).toContain('StoreTimeoutError')
  })
})


describe('summaries an earlier version wrote at a plain key for a random id', () => {
  const RANDOM_ID = '3fba3d5e-61c2-4a55-9d3f-8b1e2f4a6c70'
  const plainKey = `threads/${RANDOM_ID}`
  const stale = { ...row(RANDOM_ID, 'completed'), updatedAt: '2026-10-09T08:00:00.000Z', priority: 'medium' as const }

  it('are read by id, but left out of the list, which uses the legacy index row for that thread instead', async () => {
    const store = createMemoryStore()
    await store.set(plainKey, JSON.stringify(stale))
    await store.set(LEGACY_INDEX_KEY, JSON.stringify([{ ...stale, priority: null }]))

    expect(await getThreadEntry(store, RANDOM_ID)).toEqual(stale)
    expect(await listThreads(store)).toEqual([{ ...stale, priority: null }])
  })

  it('are moved to a time-ordered key on the next write, so the thread is listed once', async () => {
    const store = createMemoryStore()
    await store.set(plainKey, JSON.stringify(stale))
    await store.set(LEGACY_INDEX_KEY, JSON.stringify([stale]))

    await writeThread(store, { ...row(RANDOM_ID, 'completed'), priority: null }, new Date('2026-10-09T12:00:00Z'))

    expect(await store.get(plainKey)).toBeUndefined()
    const listed = await listThreads(store)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: RANDOM_ID, priority: null, updatedAt: '2026-10-09T12:00:00.000Z' })
    expect((await getThreadEntry(store, RANDOM_ID))?.priority).toBeNull()
  })

  it('do not take list slots: 25 of them and 40 new threads list all 40 new ones', async () => {
    const store = createMemoryStore()
    const old = Array.from({ length: 25 }, (_, i) => `${(0xb7 + i).toString(16)}15c0de-2f4b-4e11-8a90-0c3d5e7f9a${i.toString(16).padStart(2, '0')}`)
    for (const [i, id] of old.entries()) {
      await store.set(`threads/${id}`, JSON.stringify({ ...row(id), updatedAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString() }))
    }
    const fresh = Array.from({ length: 40 }, (_, i) => newThreadId(at(i)))
    for (const [i, id] of fresh.entries()) await writeThread(store, row(id), at(i))

    const listed = await listThreads(store)

    expect(listed).toHaveLength(40)
    for (const id of fresh) expect(listed.some((entry) => entry.id === id)).toBe(true)
  })
})

describe('one row per thread, ordered by update time before the cap', () => {
  it('lists a thread once when the legacy index and a summary both know it, keeping the newer copy', async () => {
    const store = createMemoryStore()
    const id = newThreadId(at(0))
    await writeThread(store, row(id, 'completed'), new Date('2026-10-09T12:00:00Z'))
    await store.set(LEGACY_INDEX_KEY, JSON.stringify([{ ...row(id, 'awaiting_approval'), updatedAt: '2026-10-09T09:00:00.000Z', priority: null }]))
    const listed = await listThreads(store)
    expect(listed).toHaveLength(1)
    expect(listed[0].status).toBe('completed')
  })

  it('does not let 50 old legacy rows crowd out newer threads', async () => {
    const store = createMemoryStore()
    const legacy = Array.from({ length: 50 }, (_, i) => ({
      ...row(`${(0x10 + i).toString(16)}aaaaaa-1111-4222-8333-444444444444`),
      updatedAt: new Date(Date.UTC(2026, 7, 1, 0, i)).toISOString(),
    }))
    await store.set(LEGACY_INDEX_KEY, JSON.stringify(legacy))
    const fresh = Array.from({ length: 30 }, (_, i) => newThreadId(at(i)))
    for (const [i, id] of fresh.entries()) await writeThread(store, row(id), at(i))

    const listed = await listThreads(store)

    expect(listed).toHaveLength(50)
    for (const id of fresh) expect(listed.some((entry) => entry.id === id)).toBe(true)
    expect(listed.filter((entry) => entry.updatedAt.startsWith('2026-08'))).toHaveLength(20)
  })
})
