import { describe, expect, it } from 'vitest'
import { createMemoryStore, type KeyValueStore } from '../../netlify/shared/store'
import {
  getThreadEntry,
  LEGACY_INDEX_KEY,
  listThreads,
  MAX_LISTED_THREADS,
  newThreadId,
  titleFor,
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
