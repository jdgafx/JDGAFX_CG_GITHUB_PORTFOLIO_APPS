import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../../netlify/shared/store'
import { keepIndexed, MAX_INDEXED_THREADS, readThreadIndex, upsertThread } from '../../netlify/shared/thread-index'
import type { ThreadEntry } from '../../src/types'

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 8, 0, minutes))

describe('thread index eviction', () => {
  it('never drops a thread awaiting approval, even when the index is over the cap', async () => {
    const store = createMemoryStore()
    for (let i = 0; i < 60; i += 1) {
      await upsertThread(store, { id: `wait-${i}`, title: 'Waiting', status: 'awaiting_approval', amount: 129 }, at(i))
    }
    const rows = await readThreadIndex(store)
    expect(rows).toHaveLength(60)
    expect(rows.every((row) => row.status === 'awaiting_approval')).toBe(true)
  })

  it('makes room by dropping the oldest finished threads, and keeps every waiting one', async () => {
    const store = createMemoryStore()
    for (let i = 0; i < 45; i += 1) {
      await upsertThread(store, { id: `wait-${i}`, title: 'Waiting', status: 'awaiting_approval', amount: 129 }, at(i))
    }
    for (let i = 0; i < 10; i += 1) {
      await upsertThread(store, { id: `done-${i}`, title: 'Done', status: 'completed', amount: 24.5 }, at(100 + i))
    }
    const rows = await readThreadIndex(store)
    expect(rows).toHaveLength(MAX_INDEXED_THREADS)
    expect(rows.filter((row) => row.status === 'awaiting_approval')).toHaveLength(45)
    expect(rows.filter((row) => row.status === 'completed').map((row) => row.id)).toEqual([
      'done-9',
      'done-8',
      'done-7',
      'done-6',
      'done-5',
    ])
  })

  it('keeps an old waiting thread even when newer finished threads fill the index', async () => {
    const store = createMemoryStore()
    await upsertThread(store, { id: 'old-wait', title: 'Old', status: 'awaiting_approval', amount: 129 }, at(0))
    for (let i = 0; i < 60; i += 1) {
      await upsertThread(store, { id: `done-${i}`, title: 'Done', status: 'completed', amount: 0 }, at(10 + i))
    }
    const rows = await readThreadIndex(store)
    expect(rows).toHaveLength(MAX_INDEXED_THREADS)
    expect(rows.some((row) => row.id === 'old-wait')).toBe(true)
  })

  it('keeps a waiting thread when its own status changes to completed later', async () => {
    const store = createMemoryStore()
    await upsertThread(store, { id: 'resumed', title: 'Resumed', status: 'awaiting_approval', amount: 129 }, at(0))
    await upsertThread(store, { id: 'resumed', title: 'Resumed', status: 'completed', amount: 129 }, at(5))
    const rows = await readThreadIndex(store)
    expect(rows.map((row) => [row.id, row.status])).toEqual([['resumed', 'completed']])
  })
})

describe('keepIndexed', () => {
  const row = (id: string, status: ThreadEntry['status'], minute: number): ThreadEntry => ({
    id,
    title: id,
    status,
    updatedAt: at(minute).toISOString(),
    amount: null,
  })

  it('returns every row unchanged while the index is under the cap', () => {
    const rows = [row('a', 'completed', 1), row('b', 'failed', 2), row('c', 'awaiting_approval', 3)]
    expect(keepIndexed(rows).map((item) => item.id)).toEqual(['c', 'b', 'a'])
  })

  it('keeps all waiting rows when they alone exceed the cap', () => {
    const waiting = Array.from({ length: 52 }, (_, i) => row(`w${i}`, 'awaiting_approval', i))
    const kept = keepIndexed(waiting)
    expect(kept).toHaveLength(52)
  })
})
