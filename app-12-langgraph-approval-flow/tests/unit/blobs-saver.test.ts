import { describe, expect, it } from 'vitest'
import { emptyCheckpoint, type Checkpoint, type CheckpointMetadata } from '@langchain/langgraph'
import { GraphGateSaver } from '../../netlify/shared/blobs-saver'
import { createMemoryStore, type KeyValueStore } from '../../netlify/shared/store'
import { readThreadIndex, THREAD_INDEX_KEY, upsertThread } from '../../netlify/shared/thread-index'

/** A checkpoint with a fixed id, so ordering in the tests does not depend on the clock. */
function checkpointWith(id: string, values: Record<string, unknown>): Checkpoint {
  return { ...emptyCheckpoint(), id, channel_values: values }
}

const meta = (step: number): CheckpointMetadata => ({ source: 'loop', step, parents: {} })

async function twoCheckpoints(saver: GraphGateSaver, threadId: string) {
  const first = checkpointWith('0001', { ticket: 'first' })
  const second = checkpointWith('0002', { ticket: 'second' })
  await saver.put({ configurable: { thread_id: threadId, checkpoint_ns: '' } }, first, meta(0))
  const parent = { configurable: { thread_id: threadId, checkpoint_ns: '', checkpoint_id: first.id } }
  await saver.put(parent, second, meta(1))
  return { first, second }
}

describe('GraphGateSaver: checkpoints', () => {
  it('round-trips a checkpoint and its metadata, and reads the newest by default', async () => {
    const saver = new GraphGateSaver(createMemoryStore())
    const { first, second } = await twoCheckpoints(saver, 'thread-a')

    const latest = await saver.getTuple({ configurable: { thread_id: 'thread-a' } })
    expect(latest?.checkpoint.id).toBe(second.id)
    expect(latest?.checkpoint.channel_values).toEqual({ ticket: 'second' })
    expect(latest?.metadata).toEqual(meta(1))
    expect(latest?.parentConfig?.configurable?.checkpoint_id).toBe(first.id)

    const older = await saver.getTuple({ configurable: { thread_id: 'thread-a', checkpoint_id: first.id } })
    expect(older?.checkpoint.channel_values).toEqual({ ticket: 'first' })
    expect(older?.parentConfig).toBeUndefined()
  })

  it('returns undefined for a thread that was never saved', async () => {
    const saver = new GraphGateSaver(createMemoryStore())
    expect(await saver.getTuple({ configurable: { thread_id: 'nobody' } })).toBeUndefined()
  })

  it('lists checkpoints newest first, honours limit, before and filter', async () => {
    const saver = new GraphGateSaver(createMemoryStore())
    const { first, second } = await twoCheckpoints(saver, 'thread-b')
    const config = { configurable: { thread_id: 'thread-b' } }

    const all: string[] = []
    for await (const tuple of saver.list(config)) all.push(tuple.checkpoint.id)
    expect(all).toEqual([second.id, first.id])

    const limited: string[] = []
    for await (const tuple of saver.list(config, { limit: 1 })) limited.push(tuple.checkpoint.id)
    expect(limited).toEqual([second.id])

    const before: string[] = []
    for await (const tuple of saver.list(config, { before: { configurable: { checkpoint_id: second.id } } })) {
      before.push(tuple.checkpoint.id)
    }
    expect(before).toEqual([first.id])

    const filtered: string[] = []
    for await (const tuple of saver.list(config, { filter: { step: 0 } })) filtered.push(tuple.checkpoint.id)
    expect(filtered).toEqual([first.id])
  })

  it('deletes every checkpoint and write of one thread, and leaves other threads alone', async () => {
    const store = createMemoryStore()
    const saver = new GraphGateSaver(store)
    await twoCheckpoints(saver, 'thread-c')
    await twoCheckpoints(saver, 'thread-d')

    await saver.deleteThread('thread-c')

    expect(await saver.getTuple({ configurable: { thread_id: 'thread-c' } })).toBeUndefined()
    expect((await store.list('thread/thread-c/')).length).toBe(0)
    expect((await saver.getTuple({ configurable: { thread_id: 'thread-d' } }))?.checkpoint.id).toBe('0002')
  })

  it('refuses a subgraph namespace, because only the root namespace is stored', async () => {
    const saver = new GraphGateSaver(createMemoryStore())
    await expect(
      saver.put({ configurable: { thread_id: 'thread-e', checkpoint_ns: 'review:abc' } }, checkpointWith('0001', {}), meta(0)),
    ).rejects.toThrow('root checkpoint namespace')
  })
})

describe('GraphGateSaver: pending writes', () => {
  it('saves pending writes with the checkpoint and returns them in task order', async () => {
    const saver = new GraphGateSaver(createMemoryStore())
    const { second } = await twoCheckpoints(saver, 'thread-f')
    const config = { configurable: { thread_id: 'thread-f', checkpoint_ns: '', checkpoint_id: second.id } }

    await saver.putWrites(config, [['ticket', 'written']], 'task-b')
    await saver.putWrites(config, [['ticket', 'earlier-task']], 'task-a')

    const tuple = await saver.getTuple({ configurable: { thread_id: 'thread-f', checkpoint_id: second.id } })
    expect(tuple?.pendingWrites).toEqual([
      ['task-a', 'ticket', 'earlier-task'],
      ['task-b', 'ticket', 'written'],
    ])
  })

  it('keeps the first value for an ordinary slot, as MemorySaver does', async () => {
    const saver = new GraphGateSaver(createMemoryStore())
    const { second } = await twoCheckpoints(saver, 'thread-g')
    const config = { configurable: { thread_id: 'thread-g', checkpoint_id: second.id } }

    await saver.putWrites(config, [['ticket', 'first write']], 'task-x')
    await saver.putWrites(config, [['ticket', 'retry write']], 'task-x')

    const tuple = await saver.getTuple(config)
    expect(tuple?.pendingWrites).toEqual([['task-x', 'ticket', 'first write']])
  })

  it('stores an interrupt in its fixed special slot, so a pause is visible in the checkpoint', async () => {
    const store = createMemoryStore()
    const saver = new GraphGateSaver(store)
    const { second } = await twoCheckpoints(saver, 'thread-h')
    const config = { configurable: { thread_id: 'thread-h', checkpoint_id: second.id } }

    const interruptValue = [{ value: { triage: { priority: 'high' } }, resumable: true }]
    await saver.putWrites(config, [['__interrupt__', interruptValue]], 'review-task')

    const tuple = await saver.getTuple(config)
    expect(tuple?.pendingWrites?.map(([task, channel]) => [task, channel])).toEqual([['review-task', '__interrupt__']])
    expect(tuple?.pendingWrites?.[0][2]).toEqual(interruptValue)
    expect(await store.list('thread/thread-h/writes/0002/review-task/-3')).toEqual([
      'thread/thread-h/writes/0002/review-task/-3',
    ])
  })
})

describe('thread index', () => {
  const row = (id: string, status: 'awaiting_approval' | 'completed', priority: 'high' | 'low' | null) => ({
    id,
    title: `acme/widgets #1: ${id}`,
    repo: 'acme/widgets',
    number: 1,
    status,
    priority,
  })

  it('stores one row per thread, newest first, and replaces a row when the thread changes', async () => {
    const store: KeyValueStore = createMemoryStore()
    await upsertThread(store, row('a', 'awaiting_approval', 'high'), new Date('2026-10-08T10:00:00Z'))
    await upsertThread(store, row('b', 'completed', 'low'), new Date('2026-10-08T11:00:00Z'))
    await upsertThread(store, row('a', 'completed', 'high'), new Date('2026-10-08T12:00:00Z'))

    const rows = await readThreadIndex(store)
    expect(rows.map((entry) => [entry.id, entry.status, entry.priority])).toEqual([
      ['a', 'completed', 'high'],
      ['b', 'completed', 'low'],
    ])
    expect(rows[0].updatedAt).toBe('2026-10-08T12:00:00.000Z')
  })

  it('keeps only the 50 newest threads', async () => {
    const store = createMemoryStore()
    for (let i = 0; i < 55; i += 1) {
      await upsertThread(store, row(`t-${i}`, 'completed', null), new Date(Date.UTC(2026, 9, 1, 0, i)))
    }
    const rows = await readThreadIndex(store)
    expect(rows).toHaveLength(50)
    expect(rows[0].id).toBe('t-54')
    expect(rows.some((entry) => entry.id === 't-0')).toBe(false)
  })

  it('reads a damaged index as empty instead of failing the page', async () => {
    const store = createMemoryStore()
    await store.set(THREAD_INDEX_KEY, '{not json')
    expect(await readThreadIndex(store)).toEqual([])
    await store.set(THREAD_INDEX_KEY, JSON.stringify([{ id: 'x', status: 'unknown' }]))
    expect(await readThreadIndex(store)).toEqual([])
  })
})
