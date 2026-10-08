import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunBudget } from '../../netlify/shared/budget'
import type { StreamEvent } from '../../netlify/shared/events'
import { startRun, type RunDeps } from '../../netlify/shared/run'
import { createMemoryStore, STORE_SLOW, type KeyValueStore } from '../../netlify/shared/store'
import { readThreadIndex } from '../../netlify/shared/thread-index'
import { fakeChat } from '../helpers/fake-chat'
import { untilSettled } from '../helpers/fake-time'

const NOW = new Date('2026-10-08T12:00:00Z')
const TICKET = 'Order ORD-1077 arrived with a dead wheel on the mouse, please refund that item.'
const NEVER = () => new Promise<never>(() => {})

/** A store whose checkpoint reads, or writes, never resolve. The thread index still answers. */
function hangingCheckpoints(hang: 'get' | 'set'): KeyValueStore {
  const memory = createMemoryStore()
  const isCheckpoint = (key: string) => key.startsWith('thread/')
  return {
    get: (key) => (hang === 'get' && isCheckpoint(key) ? NEVER() : memory.get(key)),
    set: (key, value) => (hang === 'set' && isCheckpoint(key) ? NEVER() : memory.set(key, value)),
    delete: (key) => memory.delete(key),
    list: (prefix) => memory.list(prefix),
  }
}

describe('a run whose checkpoint store never answers', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['get', 'set'] as const)(
    'ends with a plain error and a failed index row when a checkpoint %s never resolves',
    async (hang) => {
      const store = hangingCheckpoints(hang)
      const events: StreamEvent[] = []
      const budget = new RunBudget()
      const deps: RunDeps = { store, storage: 'memory', chat: fakeChat(), now: () => NOW }

      await untilSettled(
        startRun(deps, {
          ticket: TICKET,
          threadId: `hang-${hang}`,
          budget: budget.signal,
          send: (event) => events.push(event),
        }),
      )
      budget.dispose()

      expect(events.find((event) => event.type === 'error')).toEqual({ type: 'error', message: STORE_SLOW })
      expect(events.some((event) => event.type === 'result')).toBe(false)
      const index = await readThreadIndex(store)
      expect(index).toEqual([expect.objectContaining({ id: `hang-${hang}`, status: 'failed' })])
    },
  )
})
