import { afterEach, describe, expect, it, vi } from 'vitest'
import { MODEL, RUN_TTL_MS, type BlindCompareResponse, type CompareResponse, type LeaderboardResponse, type VoteResponse } from '../../netlify/shared/contract'
import { TEST_KEY, useTestKey } from '../helpers'
import { providerStub, reply, request } from './fixtures'

const BASE = 'http://localhost:8888/api'
const PROMPT = 'Reply with one word.'
const GEMINI = 'google/gemini-2.5-flash-lite'
const SONNET = 'anthropic/claude-sonnet-5'
const MODELS = ['ignored', GEMINI, SONNET]
const TEXT: Record<string, string> = { [MODEL]: 'haiku-says-alpha', [GEMINI]: 'gemini-says-beta', [SONNET]: 'sonnet-says-gamma' }

type KeyValue = import('../../netlify/shared/store').KeyValueStore

async function arena(wrap: (store: KeyValue) => KeyValue = s => s) {
  vi.resetModules()
  const storeModule = await import('../../netlify/shared/store')
  const memory = storeModule.createMemoryStore()
  storeModule.useStoreForTests(wrap(memory))
  return {
    memory,
    compare: (await import('../../netlify/functions/compare')).default,
    vote: (await import('../../netlify/functions/vote')).default,
    leaderboard: (await import('../../netlify/functions/leaderboard')).default,
  }
}

type Arena = Awaited<ReturnType<typeof arena>>

function answerAll() {
  return providerStub(model => reply(`${model}-served`, TEXT[model], { completion: 7, cost: 0.000004 }))
}

async function blindRun(a: Arena, blind = true): Promise<BlindCompareResponse> {
  const res = await a.compare(request(`${BASE}/compare`, 'POST', { prompt: PROMPT, models: MODELS, blind }))
  expect(res.status).toBe(200)
  return (await res.json()) as BlindCompareResponse
}

// The label the visitor saw the given model's text under.
function labelOf(run: BlindCompareResponse, model: string): 'A' | 'B' | 'C' {
  const found = run.answers.find(answer => answer.text === TEXT[model])
  if (!found) throw new Error(`no answer for ${model}`)
  return found.label
}

async function cast(a: Arena, runId: string, choice: string) {
  return a.vote(request(`${BASE}/vote`, 'POST', { runId, choice }))
}

async function board(a: Arena): Promise<LeaderboardResponse> {
  return (await a.leaderboard(request(`${BASE}/leaderboard`, 'GET'))).json() as Promise<LeaderboardResponse>
}

const rating = (b: LeaderboardResponse, model: string) => b.rows.find(r => r.model === model)

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('blind compare', () => {
  useTestKey()

  it('returns only the answers, under shuffled labels, with nothing that names a model', async () => {
    answerAll()
    const a = await arena()
    const run = await blindRun(a)
    expect(run.blind).toBe(true)
    expect(run.answers.map(x => x.label)).toEqual(['A', 'B', 'C'])
    expect(run.answers.map(x => x.text).sort()).toEqual(Object.values(TEXT).sort())
    const wire = JSON.stringify(run)
    for (const secret of [MODEL, GEMINI, SONNET, 'served', 'requestedModel', 'servedModel', 'cost', 'usage', 'latencyMs', TEST_KEY]) {
      expect(wire).not.toContain(secret)
    }
    expect(Date.parse(run.expiresAt)).toBeGreaterThan(Date.now())
    expect(Date.parse(run.expiresAt)).toBeLessThanOrEqual(Date.now() + RUN_TTL_MS)
  })

  it('stores the real run, including the order it shuffled to, until the vote', async () => {
    answerAll()
    const a = await arena()
    const run = await blindRun(a)
    const stored = JSON.parse((await a.memory.get(`runs/${run.runId}`)) as string) as { compare: CompareResponse; order: string[] }
    expect([...stored.order].sort()).toEqual(['A', 'B', 'C'])
    // order[i] is the real slot behind label i; the real slots are A = Haiku, B = Gemini, C = Sonnet.
    const realModel = ['A', 'B', 'C'].map((_, i) => stored.compare.panels.find(p => p.slot === stored.order[i])?.requestedModel)
    expect(realModel.map(m => TEXT[m as string])).toEqual(run.answers.map(x => x.text))
  })

  it('shows the models openly, and opens no vote, when it was not asked to be blind', async () => {
    answerAll()
    const a = await arena()
    const open = (await blindRun(a, false)) as unknown as CompareResponse
    expect(open.panels.map(p => p.requestedModel)).toEqual([MODEL, GEMINI, SONNET])
    expect(await a.memory.list('runs/')).toEqual([])
    const res = await cast(a, open.runId, 'A')
    expect(res.status).toBe(410)
  })

  it('shows the models openly when fewer than two different models answered', async () => {
    providerStub(model => (model === MODEL ? reply(model, 'only-one') : new Response('{}', { status: 429 })))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const a = await arena()
    const body = (await blindRun(a)) as unknown as CompareResponse
    expect(body.notVoteable).toMatch(/Fewer than two different models answered/)
    expect(body.panels[0].requestedModel).toBe(MODEL)
    expect(await a.memory.list('runs/')).toEqual([])
  })

  it('shows the models openly, and says why, when the run cannot be stored', async () => {
    answerAll()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const a = await arena(store => ({ ...store, set: () => Promise.reject(new Error('blobs down')) }))
    const body = (await blindRun(a)) as unknown as CompareResponse
    expect(body.notVoteable).toBe('Votes are unavailable right now, so the models are shown openly.')
    expect(body.panels.map(p => p.requestedModel)).toEqual([MODEL, GEMINI, SONNET])
  })
})

describe('vote', () => {
  useTestKey()

  it('counts the vote, reveals every model with its served model, tokens and cost, and updates the board', async () => {
    answerAll()
    const a = await arena()
    const run = await blindRun(a)
    const winner = labelOf(run, SONNET)
    const res = await cast(a, run.runId, winner)
    expect(res.status).toBe(200)
    const body = (await res.json()) as VoteResponse
    expect(body.choice).toBe(winner)
    // The reveal keeps the labels the visitor saw.
    expect(body.compare.panels.map(p => p.slot)).toEqual(['A', 'B', 'C'])
    for (const panel of body.compare.panels) {
      expect(panel.text).toBe(run.answers.find(x => x.label === panel.slot)?.text)
      expect(panel.servedModel).toBe(`${panel.requestedModel}-served`)
      expect(panel.usage.completion_tokens).toBe(7)
      expect(panel.cost).toEqual({ usd: 0.000004, source: 'usage' })
    }
    expect(body.compare.panels.find(p => p.slot === winner)?.requestedModel).toBe(SONNET)
    expect(body.compare.trace.map(t => t.name)).toEqual(['Panel A request', 'Panel B request', 'Panel C request'])
    // A winner among three beats two models: +24, and each loser gives up 12.
    // Rows are keyed by the model that answered, never by the id the request used (Panel A asks for the alias).
    const served = (model: string) => `${model}-served`
    expect(body.leaderboard.rows.map(r => [r.model, r.rating, r.wins, r.losses, r.votes])).toEqual([
      [served(SONNET), 1024, 2, 0, 1],
      [served(MODEL), 988, 0, 1, 1],
      [served(GEMINI), 988, 0, 1, 1],
    ])
    expect(body.leaderboard.rows.some(r => r.model === MODEL)).toBe(false)
    expect(body.changes.find(c => c.model === served(SONNET))).toEqual({ model: served(SONNET), before: 1000, after: 1024 })
    expect(rating(body.leaderboard, served(SONNET))?.lastServed).toBe(served(SONNET))
    expect(await board(a)).toEqual(body.leaderboard)
    expect(await a.memory.list('runs/')).toEqual([])
  })

  it('records a tie as a draw and "all bad" as a ballot with no rating change', async () => {
    answerAll()
    const a = await arena()
    expect((await cast(a, (await blindRun(a)).runId, 'tie')).status).toBe(200)
    expect((await cast(a, (await blindRun(a)).runId, 'all-bad')).status).toBe(200)
    const b = await board(a)
    expect(b).toMatchObject({ ballots: 2, ties: 1, allBad: 1 })
    expect(b.rows.map(r => [r.rating, r.ties, r.votes])).toEqual([[1000, 2, 2], [1000, 2, 2], [1000, 2, 2]])
  })

  it('accepts one vote per run: a second vote is refused and the board does not move', async () => {
    answerAll()
    const a = await arena()
    const run = await blindRun(a)
    const stored = (await a.memory.get(`runs/${run.runId}`)) as string
    expect((await cast(a, run.runId, 'A')).status).toBe(200)
    expect((await cast(a, run.runId, 'B')).status).toBe(410)
    // Even if the stored run came back, the board remembers the run id.
    await a.memory.set(`runs/${run.runId}`, stored)
    const again = await cast(a, run.runId, 'B')
    expect(again.status).toBe(409)
    expect(await board(a)).toMatchObject({ ballots: 1 })
  })

  it('refuses two votes sent together for one run: exactly one is counted', async () => {
    answerAll()
    const a = await arena()
    const run = await blindRun(a)
    const results = await Promise.all([cast(a, run.runId, 'A'), cast(a, run.runId, 'A'), cast(a, run.runId, 'C')])
    expect(results.map(r => r.status).filter(s => s === 200)).toHaveLength(1)
    expect((await board(a)).ballots).toBe(1)
  })

  it('validates the request at the boundary', async () => {
    answerAll()
    const a = await arena()
    const run = await blindRun(a)
    const post = (body: unknown, raw?: string) => a.vote(request(`${BASE}/vote`, 'POST', body, { raw }))
    expect((await post(undefined, 'not json')).status).toBe(400)
    expect((await post([])).status).toBe(400)
    expect((await post({ choice: 'A' })).status).toBe(400)
    expect((await post({ runId: 'abc', choice: 'A' })).status).toBe(400)
    expect((await post({ runId: run.runId })).status).toBe(400)
    expect((await post({ runId: run.runId, choice: 'D' })).status).toBe(400)
    expect((await post({ runId: run.runId, choice: 7 })).status).toBe(400)
    expect((await post({ runId: run.runId, choice: 'A', extra: 'x'.repeat(2000) })).status).toBe(400)
    const unknown = `${Date.now() + 60_000}-00000000-0000-4000-8000-000000000000`
    expect((await post({ runId: unknown, choice: 'A' })).status).toBe(410)
    const expired = `${Date.now() - 1_000}-00000000-0000-4000-8000-000000000001`
    await a.memory.set(`runs/${expired}`, (await a.memory.get(`runs/${run.runId}`)) as string)
    expect((await post({ runId: expired, choice: 'A' })).status).toBe(410)
    expect(await a.memory.get(`runs/${expired}`)).toBeUndefined()
    expect((await board(a)).ballots).toBe(0)
  })

  it('refuses a panel that did not answer and a run with no two different models', async () => {
    providerStub(model => (model === SONNET ? new Response('{}', { status: 429 }) : reply(model, TEXT[model])))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const a = await arena()
    const run = await blindRun(a)
    expect(run.answers.filter(x => !x.ok)).toHaveLength(1)
    const failed = run.answers.find(x => !x.ok)!.label
    const res = await cast(a, run.runId, failed)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe(`Panel ${failed} did not give an answer, so it cannot be picked.`)
    // The two answering panels can still be voted on.
    const ok = run.answers.find(x => x.ok)!.label
    expect((await cast(a, run.runId, ok)).status).toBe(200)
    expect((await board(a)).rows).toHaveLength(2)
  })

  it('loses no vote when many arrive together', async () => {
    answerAll()
    // 12 compares and 12 votes pass through one rate limit; this test is about the board, not the limit.
    vi.stubEnv('RATE_LIMIT_MAX', '100')
    // Every store call yields first, so racing votes really interleave their reads and writes.
    const slow = (store: KeyValue): KeyValue => {
      const later = <T>(work: () => Promise<T>) => new Promise<T>(resolve => setTimeout(() => resolve(work()), Math.random() * 3))
      return {
        get: k => later(() => store.get(k)),
        set: (k, v) => later(() => store.set(k, v)),
        delete: k => later(() => store.delete(k)),
        list: p => later(() => store.list(p)),
        setIfNew: (k, v) => later(() => store.setIfNew(k, v)),
        getTagged: k => later(() => store.getTagged(k)),
        setIfMatch: (k, v, e) => later(() => store.setIfMatch(k, v, e)),
      }
    }
    const a = await arena(slow)
    const runs = []
    for (let i = 0; i < 12; i++) runs.push(await blindRun(a))
    const results = await Promise.all(runs.map((run, i) => cast(a, run.runId, ['A', 'B', 'C'][i % 3])))
    const statuses = results.map(r => r.status)
    // Each ballot is its own blob, so no vote can lose a race: every one is counted and on the board.
    const counted = statuses.filter(s => s === 200).length
    expect(statuses.every(s => s === 200)).toBe(true)
    expect(counted).toBe(12)
    const b = await board(a)
    expect(b.ballots).toBe(counted)
    for (const row of b.rows) expect(row.votes).toBe(counted)
    expect(b.rows.reduce((sum, r) => sum + r.rating, 0)).toBeCloseTo(3000, 6)
    expect(b.rows.reduce((sum, r) => sum + r.wins, 0)).toBe(b.rows.reduce((sum, r) => sum + r.losses, 0))
  })
})

describe('leaderboard', () => {
  it('is empty before the first vote and says where votes are kept', async () => {
    const a = await arena()
    expect(await board(a)).toEqual({ rows: [], ballots: 0, ties: 0, allBad: 0, updatedAt: null, storage: 'memory' })
  })

  it('answers GET only', async () => {
    const a = await arena()
    expect((await a.leaderboard(request(`${BASE}/leaderboard`, 'POST', {}))).status).toBe(405)
  })
})
