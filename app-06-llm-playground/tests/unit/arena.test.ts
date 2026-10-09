import { describe, expect, it } from 'vitest'
import { castBallot, displayPanels, planBallot, shuffleOrder, voteable, type StoredRun } from '../../netlify/shared/arena'
import type { CompareResponse, PanelResult, Slot } from '../../netlify/shared/contract'
import { createMemoryStore } from '../../netlify/shared/store'

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
  const nap = async () => undefined

  it('creates the board on the first ballot and refuses the same run id afterwards', async () => {
    const store = createMemoryStore()
    const first = await castBallot(store, 'memory', { runId: id(1), entries, outcome: { winner: 0 }, tie: false }, Date.now(), nap)
    expect(first).toMatchObject({ kind: 'counted', board: { ballots: 1 } })
    expect(await castBallot(store, 'memory', { runId: id(1), entries, outcome: { winner: 1 }, tie: false }, Date.now(), nap)).toEqual({ kind: 'duplicate' })
  })

  it('reports busy, and writes nothing, when every attempt loses the race', async () => {
    const store = createMemoryStore()
    await castBallot(store, 'memory', { runId: id(1), entries, outcome: { winner: 0 }, tie: false }, Date.now(), nap)
    const losing = { ...store, setIfMatch: async () => false }
    const result = await castBallot(losing, 'memory', { runId: id(2), entries, outcome: { winner: 0 }, tie: false }, Date.now(), nap)
    expect(result).toEqual({ kind: 'busy' })
    expect(JSON.parse((await store.get('leaderboard')) as string)).toMatchObject({ ballots: 1 })
  })

  it('forgets run ids once their runs could no longer take a vote', async () => {
    const store = createMemoryStore()
    const old = `${Date.now() + 1_000}-00000000-0000-4000-8000-000000000009`
    await castBallot(store, 'memory', { runId: old, entries, outcome: 'tie', tie: true }, Date.now(), nap)
    await castBallot(store, 'memory', { runId: id(3), entries, outcome: 'tie', tie: true }, Date.now() + 5_000, nap)
    const doc = JSON.parse((await store.get('leaderboard')) as string) as { recent: { runId: string }[] }
    expect(doc.recent.map(r => r.runId)).toEqual([id(3)])
  })
})
