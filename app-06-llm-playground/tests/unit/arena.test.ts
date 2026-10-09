import { describe, expect, it } from 'vitest'
import { castBallot, displayPanels, planBallot, readBoard, shuffleOrder, voteable, type StoredRun } from '../../netlify/shared/arena'
import { applyBallot, type Outcome, type Ratings } from '../../netlify/shared/elo'
import type { CompareResponse, PanelResult, Slot } from '../../netlify/shared/contract'
import { createMemoryStore, type KeyValueStore } from '../../netlify/shared/store'

function panel(slot: Slot, model: string, ok = true): PanelResult {
  return {
    slot,
    requestedModel: model,
    servedModel: `${model}-s`,
    ok,
    error: ok ? null : 'x',
    text: ok ? `text ${slot}` : '',
    finishReason: 'stop',
    latencyMs: 10,
    usage: { prompt_tokens: 1, completion_tokens: 1, reasoning_tokens: null, total_tokens: 2 },
    cost: null,
  }
}

function run(panels: PanelResult[], order: Slot[]): StoredRun {
  return { compare: { runId: 'r', totalMs: 1, panels, trace: [], summary: { fastest: null, cheapest: null, mostOutputTokens: null, measuredAt: '' } } as CompareResponse, order }
}

describe('shuffleOrder', () => {
  it('is a permutation of A, B, C and reaches all six orders', () => {
    const seen = new Set<string>()
    for (let n = 0; n < 6; n++) {
      // Fix the draws: the Fisher-Yates picks for n in base (3, 2).
      const picks = [Math.floor(n / 2), n % 2]
      let call = 0
      seen.add(shuffleOrder(() => picks[call++]).join(''))
    }
    expect(seen.size).toBe(6)
    expect([...seen].every(o => [...o].sort().join('') === 'ABC')).toBe(true)
  })

  it('keeps the order when every draw picks the last place', () => {
    expect(shuffleOrder(n => n - 1)).toEqual(['A', 'B', 'C'])
  })
})

describe('displayPanels', () => {
  it('puts the real panel named by the order under each shown label', () => {
    const shown = displayPanels([panel('A', 'm1'), panel('B', 'm2'), panel('C', 'm3')], ['C', 'A', 'B'])
    expect(shown.map(p => [p.slot, p.requestedModel])).toEqual([['A', 'm3'], ['B', 'm1'], ['C', 'm2']])
  })
})

describe('planBallot', () => {
  const three = run([panel('A', 'm1'), panel('B', 'm2'), panel('C', 'm3')], ['B', 'C', 'A'])

  it('maps the label the visitor picked to the entry for that panel', () => {
    const plan = planBallot(three, 'A')
    expect(plan).toMatchObject({ ok: true, outcome: { winner: 0 }, tie: false })
    expect(plan.ok && plan.entries.map(e => e.model)).toEqual(['m2', 'm3', 'm1'])
  })

  it('leaves unanswered panels out and refuses to pick one', () => {
    const partial = run([panel('A', 'm1'), panel('B', 'm2', false), panel('C', 'm3')], ['A', 'B', 'C'])
    const plan = planBallot(partial, 'C')
    expect(plan.ok && plan.entries.map(e => e.model)).toEqual(['m1', 'm3'])
    expect(plan.ok && plan.outcome).toEqual({ winner: 1 })
    expect(planBallot(partial, 'B')).toEqual({ ok: false, error: 'Panel B did not give an answer, so it cannot be picked.' })
  })

  it('needs two different models', () => {
    const same = run([panel('A', 'm1'), panel('B', 'm1'), panel('C', 'm3', false)], ['A', 'B', 'C'])
    expect(planBallot(same, 'tie').ok).toBe(false)
    expect(voteable(same.compare.panels)).toBe(false)
    expect(voteable([panel('A', 'm1'), panel('B', 'm2')])).toBe(true)
  })
})

describe('castBallot', () => {
  const expiry = Date.now() + 60_000
  const id = (n: number) => `${expiry}-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const entries = [{ model: 'a', served: null }, { model: 'b', served: null }]
  const ballot = (n: number, outcome: Outcome = { winner: 0 }) => ({ runId: id(n), entries, outcome, tie: outcome === 'tie' })

  it('writes the ballot as its own blob, reports what it changed, and refuses the same run id again', async () => {
    const store = createMemoryStore()
    const first = await castBallot(store, 'memory', ballot(1), 1_000)
    expect(first).toMatchObject({ kind: 'counted', board: { ballots: 1 }, changes: [{ model: 'a', before: 1000, after: 1012 }, { model: 'b', before: 1000, after: 988 }] })
    expect(await store.list('votes/')).toEqual([`votes/${id(1)}`])
    expect(await castBallot(store, 'memory', ballot(1, { winner: 1 }), 2_000)).toEqual({ kind: 'duplicate' })
    expect((await readBoard(store, 'memory')).ballots).toBe(1)
  })

  it('counts every ballot of many cast together, even when no shared record can be written', async () => {
    const memory = createMemoryStore()
    const later = <T,>(work: () => Promise<T>) => new Promise<T>(resolve => setTimeout(() => resolve(work()), Math.random() * 4))
    // A store whose conditional record write always reports "not modified" and whose tagged read fails: anything that
    // depends on updating one shared record would lose votes here. Ballots only need setIfNew, which stays honest.
    const hostile: KeyValueStore = {
      get: k => later(() => memory.get(k)),
      set: (k, v) => later(() => memory.set(k, v)),
      delete: k => later(() => memory.delete(k)),
      list: p => later(() => memory.list(p)),
      setIfNew: (k, v) => later(() => memory.setIfNew(k, v)),
      getTagged: () => Promise.reject(new Error('tagged reads unavailable')),
      setIfMatch: async () => false,
    }
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => castBallot(hostile, 'memory', ballot(i + 1, { winner: i % 2 }), 10_000 + i)))
    expect(results.every(r => r.kind === 'counted')).toBe(true)
    const board = await readBoard(memory, 'memory')
    expect(board.ballots).toBe(24)
    expect(board.rows.every(r => r.votes === 24)).toBe(true)
    expect(board.rows.reduce((sum, r) => sum + r.rating, 0)).toBeCloseTo(2000, 6)
    expect(board.rows.reduce((sum, r) => sum + r.wins, 0)).toBe(24)
  })

  it('folds in the order ballots were cast, whatever order they arrived in', async () => {
    const store = createMemoryStore()
    await castBallot(store, 'memory', ballot(3, { winner: 0 }), 3_000)
    await castBallot(store, 'memory', ballot(1, { winner: 0 }), 1_000)
    await castBallot(store, 'memory', ballot(2, { winner: 1 }), 2_000)
    const sequential = [{ winner: 0 }, { winner: 1 }, { winner: 0 }].reduce<Ratings>((r, outcome) => applyBallot(r, entries, outcome).ratings, {})
    const board = await readBoard(store, 'memory')
    expect(board.rows.find(r => r.model === 'a')?.rating).toBeCloseTo(sequential.a.rating, 9)
    expect(board.rows.find(r => r.model === 'b')?.rating).toBeCloseTo(sequential.b.rating, 9)
  })

  it('answers with the new ballot included even when the listing has not caught up with the write', async () => {
    const memory = createMemoryStore()
    const lagging: KeyValueStore = { ...memory, list: async () => [] }
    const result = await castBallot(lagging, 'memory', ballot(1), 1_000)
    expect(result).toMatchObject({ kind: 'counted', board: { ballots: 1 } })
  })

  it('skips an unreadable ballot instead of failing the board', async () => {
    const store = createMemoryStore()
    await castBallot(store, 'memory', ballot(1), 1_000)
    await store.set(`votes/${id(2)}`, 'not json')
    expect((await readBoard(store, 'memory')).ballots).toBe(1)
  })
})
