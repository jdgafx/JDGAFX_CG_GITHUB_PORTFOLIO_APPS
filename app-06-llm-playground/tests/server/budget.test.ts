import { afterEach, describe, expect, it, vi } from 'vitest'
import { LEADERBOARD_BUDGET_MS, VOTE_BUDGET_MS, type CompareResponse, type PanelResult } from '../../netlify/shared/contract'
import { LEADERBOARD_CAP_MS, VOTE_CAP_MS } from '../../src/lib/api'
import { request } from './fixtures'

// A request the server makes several store calls for must end on the server's own budget, with its clear error, before
// the browser gives up: the browser's limit is the budget plus 3 s, both taken from one constant.
const BASE = 'http://localhost:8888/api'
const STORE_SLOW = 'The vote store did not answer in time. Try again.'
const CALL_MS = 5_000
const MARGIN_MS = 3_000

type KeyValue = import('../../netlify/shared/store').KeyValueStore

// Every store call answers after CALL_MS: no call times out by itself (the per-call limit is longer), yet the calls
// of one request, made in turn, add up past the budget.
const slowStore = (store: KeyValue): KeyValue => {
  const later = <T>(work: () => Promise<T>) => new Promise<T>(resolve => setTimeout(() => resolve(work()), CALL_MS))
  return {
    get: key => later(() => store.get(key)),
    set: (key, value) => later(() => store.set(key, value)),
    delete: key => later(() => store.delete(key)),
    list: prefix => later(() => store.list(prefix)),
    setIfNew: (key, value) => later(() => store.setIfNew(key, value)),
    getTagged: key => later(() => store.getTagged(key)),
    setIfMatch: (key, value, etag) => later(() => store.setIfMatch(key, value, etag)),
  }
}

const panel = (slot: 'A' | 'B' | 'C', model: string): PanelResult => ({
  slot, requestedModel: model, servedModel: model, ok: true, error: null, text: `${slot} says`, finishReason: 'stop', latencyMs: 100,
  usage: { prompt_tokens: 1, completion_tokens: 1, reasoning_tokens: null, total_tokens: 2 }, cost: null,
})

async function setup() {
  vi.resetModules()
  const store = await import('../../netlify/shared/store')
  const arena = await import('../../netlify/shared/arena')
  const memory = store.createMemoryStore()
  store.useStoreForTests(slowStore(memory))
  return {
    memory,
    arena,
    vote: (await import('../../netlify/functions/vote')).default,
    leaderboard: (await import('../../netlify/functions/leaderboard')).default,
  }
}

// Runs the handler on the fake clock and reports how long it took to answer.
async function timed(call: () => Promise<Response>): Promise<{ res: Response; tookMs: number }> {
  const start = Date.now()
  let tookMs = -1
  const pending = call().then(res => {
    tookMs = Date.now() - start
    return res
  })
  await vi.advanceTimersByTimeAsync(Math.max(VOTE_CAP_MS, LEADERBOARD_CAP_MS) + 60_000)
  return { res: await pending, tookMs }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the browser outwaits the server budget', () => {
  it('waits for a vote at least its budget plus 3 s', () => {
    expect(VOTE_CAP_MS).toBeGreaterThanOrEqual(VOTE_BUDGET_MS + MARGIN_MS)
  })

  it('waits for a leaderboard read at least its budget plus 3 s', () => {
    expect(LEADERBOARD_CAP_MS).toBeGreaterThanOrEqual(LEADERBOARD_BUDGET_MS + MARGIN_MS)
  })
})

describe('the server ends a slow request on its budget', () => {
  it('answers a vote whose store calls add up past the budget with the clear error, within the browser limit', async () => {
    vi.useFakeTimers()
    const a = await setup()
    const runId = a.arena.newRunId()
    const compare: CompareResponse = {
      runId, totalMs: 1, panels: [panel('A', 'a/one'), panel('B', 'b/two'), panel('C', 'c/three')], trace: [],
      summary: { fastest: null, cheapest: null, mostOutputTokens: null, measuredAt: '2026-10-12T00:00:00Z' },
    }
    await a.memory.set(`runs/${runId}`, JSON.stringify({ compare, order: ['A', 'B', 'C'] }))
    // Four calls in turn (read the run, write the ballot, list, read the ballots) of 5 s each are 20 s: more than the budget.
    const { res, tookMs } = await timed(() => a.vote(request(`${BASE}/vote`, 'POST', { runId, choice: 'A' })))
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: string }).error).toBe(STORE_SLOW)
    expect(tookMs).toBeLessThanOrEqual(VOTE_BUDGET_MS)
    expect(tookMs + MARGIN_MS).toBeLessThanOrEqual(VOTE_CAP_MS)
  })

  it('answers a leaderboard read of many ballots with the clear error, within the browser limit', async () => {
    vi.useFakeTimers()
    const a = await setup()
    // 100 ballots are four batches of reads after the list: 5 s each, 25 s in all.
    for (let i = 0; i < 100; i++) {
      const ballot = { runId: `r${i}`, at: i, tie: true, outcome: 'tie', entries: [{ model: 'a/one', served: 'a/one' }, { model: 'b/two', served: 'b/two' }] }
      await a.memory.set(`votes/r${i}`, JSON.stringify(ballot))
    }
    const { res, tookMs } = await timed(() => a.leaderboard(request(`${BASE}/leaderboard`, 'GET')))
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: string }).error).toBe(STORE_SLOW)
    expect(tookMs).toBeLessThanOrEqual(LEADERBOARD_BUDGET_MS)
    expect(tookMs + MARGIN_MS).toBeLessThanOrEqual(LEADERBOARD_CAP_MS)
  })
})
