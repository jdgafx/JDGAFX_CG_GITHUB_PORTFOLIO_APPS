import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../../netlify/shared/store'
import {
  getThreadEntry,
  keepIndexed,
  MAX_INDEXED_THREADS,
  readThreadIndex,
  THREAD_INDEX_KEY,
  titleFor,
  upsertThread,
} from '../../netlify/shared/thread-index'
import type { ThreadEntry } from '../../src/types'
import { issue } from '../helpers/issues'

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 9, 0, minutes))
const waiting = (id: string) => ({ id, title: 'Waiting', repo: 'acme/widgets', number: 1, status: 'awaiting_approval' as const, priority: 'high' as const })
const done = (id: string) => ({ id, title: 'Done', repo: 'acme/widgets', number: 2, status: 'completed' as const, priority: 'low' as const })

describe('thread index eviction', () => {
  it('never drops a thread awaiting a maintainer, even when the index is over the cap', async () => {
    const store = createMemoryStore()
    for (let i = 0; i < 60; i += 1) await upsertThread(store, waiting(`wait-${i}`), at(i))
    const rows = await readThreadIndex(store)
    expect(rows).toHaveLength(60)
    expect(rows.every((row) => row.status === 'awaiting_approval')).toBe(true)
  })

  it('makes room by dropping the oldest finished threads, and keeps every waiting one', async () => {
    const store = createMemoryStore()
    for (let i = 0; i < 45; i += 1) await upsertThread(store, waiting(`wait-${i}`), at(i))
    for (let i = 0; i < 10; i += 1) await upsertThread(store, done(`done-${i}`), at(100 + i))
    const rows = await readThreadIndex(store)
    expect(rows).toHaveLength(MAX_INDEXED_THREADS)
    expect(rows.filter((row) => row.status === 'awaiting_approval')).toHaveLength(45)
    expect(rows.filter((row) => row.status === 'completed').map((row) => row.id)).toEqual(['done-9', 'done-8', 'done-7', 'done-6', 'done-5'])
  })

  it('keeps an old waiting thread even when newer finished threads fill the index', async () => {
    const store = createMemoryStore()
    await upsertThread(store, waiting('old-wait'), at(0))
    for (let i = 0; i < 60; i += 1) await upsertThread(store, done(`done-${i}`), at(10 + i))
    const rows = await readThreadIndex(store)
    expect(rows).toHaveLength(MAX_INDEXED_THREADS)
    expect(rows.some((row) => row.id === 'old-wait')).toBe(true)
  })

  it('keeps a waiting thread when its own status changes to completed later', async () => {
    const store = createMemoryStore()
    await upsertThread(store, waiting('resumed'), at(0))
    await upsertThread(store, { ...waiting('resumed'), status: 'completed' }, at(5))
    const rows = await readThreadIndex(store)
    expect(rows.map((row) => [row.id, row.status])).toEqual([['resumed', 'completed']])
  })
})

describe('keepIndexed', () => {
  const row = (id: string, status: ThreadEntry['status'], minute: number): ThreadEntry => ({
    ...waiting(id),
    status,
    updatedAt: at(minute).toISOString(),
  })

  it('returns every row while the index is under the cap, newest first', () => {
    const rows = [row('a', 'completed', 1), row('b', 'failed', 2), row('c', 'awaiting_approval', 3)]
    expect(keepIndexed(rows).map((item) => item.id)).toEqual(['c', 'b', 'a'])
  })

  it('keeps all waiting rows when they alone exceed the cap', () => {
    const rows = Array.from({ length: 52 }, (_, i) => row(`w${i}`, 'awaiting_approval', i))
    expect(keepIndexed(rows)).toHaveLength(52)
  })
})

describe('threads saved by the refund version of this app', () => {
  const REFUND_ROW = {
    id: '3f2b6c1e-9a4d-4e8f-8b7a-1c2d3e4f5a6b',
    title: 'I was charged twice for ORD-1042. Both charges were $129.0...',
    status: 'awaiting_approval',
    updatedAt: '2026-10-08T12:00:00.000Z',
    amount: 129,
  }
  const NEW_ROW = {
    id: '9d1c1d3a-0f4e-4c58-9a57-2f1d6b7e8a90',
    title: 'acme/widgets #101: How do I configure the proxy?',
    repo: 'acme/widgets',
    number: 101,
    status: 'awaiting_approval',
    updatedAt: '2026-10-09T09:00:00.000Z',
    priority: 'high',
  }

  it('are left out of the list instead of crashing it, and the new rows stay', async () => {
    const store = createMemoryStore()
    await store.set(THREAD_INDEX_KEY, JSON.stringify([REFUND_ROW, NEW_ROW, { id: 5 }, null, 'text']))
    const rows = await readThreadIndex(store)
    expect(rows).toEqual([NEW_ROW])
  })

  it('cannot be opened or resumed: the index does not list them', async () => {
    const store = createMemoryStore()
    await store.set(THREAD_INDEX_KEY, JSON.stringify([REFUND_ROW]))
    expect(await getThreadEntry(store, REFUND_ROW.id)).toBeUndefined()
    expect(await readThreadIndex(store)).toEqual([])
  })

  it('are dropped from the stored index on the next write, and the new row is kept', async () => {
    const store = createMemoryStore()
    await store.set(THREAD_INDEX_KEY, JSON.stringify([REFUND_ROW]))
    await upsertThread(store, waiting('fresh'), at(1))
    const stored = JSON.parse((await store.get(THREAD_INDEX_KEY)) ?? '[]') as Array<{ id: string }>
    expect(stored.map((entry) => entry.id)).toEqual(['fresh'])
  })

  it('also fail the check when only the priority is of an unknown kind', async () => {
    const store = createMemoryStore()
    await store.set(THREAD_INDEX_KEY, JSON.stringify([{ ...NEW_ROW, priority: 'p0' }, { ...NEW_ROW, repo: undefined }]))
    expect(await readThreadIndex(store)).toEqual([])
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
    expect(title.startsWith('acme/widgets #101: word word')).toBe(true)
  })
})
