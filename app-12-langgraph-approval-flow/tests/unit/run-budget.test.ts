import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RUN_BUDGET_MS, RunBudget } from '../../netlify/shared/budget'
import type { StreamEvent } from '../../netlify/shared/events'
import { CALL_TIMEOUT_MS, PROVIDER_SLOW, ProviderError } from '../../netlify/shared/openrouter'
import { budgetMessage, startRun, type RunDeps } from '../../netlify/shared/run'
import { streamResponse } from '../../netlify/shared/sse'
import { createMemoryStore, STORE_SLOW, type KeyValueStore } from '../../netlify/shared/store'
import { readThreadIndex } from '../../netlify/shared/thread-index'
import { fakeChat } from '../helpers/fake-chat'
import { QUESTION } from '../helpers/issues'
import { untilSettled } from '../helpers/fake-time'
import { parseFrames } from '../helpers/http'

const NOW = new Date('2026-10-08T12:00:00Z')
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
          issue: QUESTION,
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
    expect(budgetMessage('reply')).toContain('25-second budget during the reply step')
    expect(CALL_TIMEOUT_MS).toBe(12_000)
    expect(CALL_TIMEOUT_MS).toBeLessThan(RUN_BUDGET_MS)
  })

  it('ends the stream with the budget error, a failed thread and [DONE] when a short budget runs out', async () => {
    const store = createMemoryStore()
    // A model call that never answers on its own and stops only when the run is aborted.
    const stalled = vi.fn((_request: unknown, signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new ProviderError(504, PROVIDER_SLOW, 'budget')))
      }),
    )
    const deps: RunDeps = { store, storage: 'memory', chat: stalled as unknown as RunDeps['chat'], now: () => NOW }

    const response = streamResponse(new RunBudget(3_000), (send, signal) =>
      startRun(deps, { issue: QUESTION, threadId: 'budget-short', budget: signal, send }),
    )
    const frames = parseFrames(await untilSettled(response.text()))

    expect(frames.find((frame) => frame !== '[DONE]' && frame.type === 'error')).toEqual({ type: 'error', message: budgetMessage('classify') })
    expect(frames.at(-1)).toBe('[DONE]')
    expect(await readThreadIndex(store)).toEqual([expect.objectContaining({ id: 'budget-short', status: 'failed' })])
  })

  it('names the budget, not the provider, when the budget ends a call, and the call limit when a call overruns', async () => {
    const store = createMemoryStore()
    const slowCall = vi.fn(() => Promise.reject(new ProviderError(504, 'The AI provider did not answer within 12 seconds.', 'timeout')))
    const deps: RunDeps = { store, storage: 'memory', chat: slowCall as unknown as RunDeps['chat'], now: () => NOW }
    const events: StreamEvent[] = []

    await startRun(deps, { issue: QUESTION, threadId: 'call-limit', budget: new AbortController().signal, send: (event) => events.push(event) })

    expect(events.find((event) => event.type === 'error')).toEqual({
      type: 'error',
      message: 'The AI provider did not answer within 12 seconds during the classify step. Finished steps are saved, so you can retry the thread.',
    })
    expect(budgetMessage('classify')).toBe(
      'The run reached its 25-second budget during the classify step and was stopped. Finished steps are saved, so you can retry the thread.',
    )
    expect(events.find((event) => event.type === 'node_end')).toMatchObject({ node: 'classify', status: 'failed' })
  })
})
