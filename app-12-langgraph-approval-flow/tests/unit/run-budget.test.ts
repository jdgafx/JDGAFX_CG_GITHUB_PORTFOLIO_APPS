import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RUN_BUDGET_MS, RunBudget } from '../../netlify/shared/budget'
import type { StreamEvent } from '../../netlify/shared/events'
import { CALL_TIMEOUT_MS } from '../../netlify/shared/openrouter'
import { RUN_BUDGET_MESSAGE, startRun, type RunDeps } from '../../netlify/shared/run'
import { streamResponse } from '../../netlify/shared/sse'
import { createMemoryStore, STORE_SLOW, type KeyValueStore } from '../../netlify/shared/store'
import { readThreadIndex } from '../../netlify/shared/thread-index'
import { fakeChat } from '../helpers/fake-chat'
import { untilSettled } from '../helpers/fake-time'
import { parseFrames } from '../helpers/http'

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

describe('the run budget', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('is 25 seconds, with the message and the model call limit to match', () => {
    expect(RUN_BUDGET_MS).toBe(25_000)
    expect(RUN_BUDGET_MESSAGE).toContain('25 seconds')
    expect(CALL_TIMEOUT_MS).toBe(12_000)
    expect(CALL_TIMEOUT_MS).toBeLessThan(RUN_BUDGET_MS)
  })

  it('ends the stream with the budget error, a failed thread and [DONE] when a short budget runs out', async () => {
    const store = createMemoryStore()
    // A model call that never answers on its own and stops only when the run is aborted.
    const stalled = vi.fn((_request: unknown, signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      }),
    )
    const deps: RunDeps = { store, storage: 'memory', chat: stalled as unknown as RunDeps['chat'], now: () => NOW }

    const response = streamResponse(new RunBudget(3_000), (send, signal) =>
      startRun(deps, { ticket: TICKET, threadId: 'budget-short', budget: signal, send }),
    )
    const frames = parseFrames(await untilSettled(response.text()))

    expect(frames.find((frame) => frame !== '[DONE]' && frame.type === 'error')).toEqual({ type: 'error', message: RUN_BUDGET_MESSAGE })
    expect(frames.at(-1)).toBe('[DONE]')
    expect(await readThreadIndex(store)).toEqual([expect.objectContaining({ id: 'budget-short', status: 'failed' })])
  })
})
