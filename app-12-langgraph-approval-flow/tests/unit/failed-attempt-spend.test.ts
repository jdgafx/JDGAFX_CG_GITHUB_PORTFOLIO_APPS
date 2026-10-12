import { describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '../../netlify/shared/events'
import type { ChatFn, ChatResult } from '../../netlify/shared/openrouter'
import { inspectThread, readThread, resumeRun, retryRun, startRun, type RunDeps } from '../../netlify/shared/run'
import { createMemoryStore, type KeyValueStore } from '../../netlify/shared/store'
import { formatTotalCost } from '../../src/lib/format'
import { applyEvent, emptyRun, runFromView } from '../../src/lib/run-state'
import { totalsOf } from '../../src/lib/totals'
import type { RunResult } from '../../src/types'
import { fakeChat } from '../helpers/fake-chat'
import { BUG, CLASSIFIED_BUG, QUESTION } from '../helpers/issues'

const NOW = new Date('2026-10-12T12:00:00Z')
const ID = 'spend-thread'
/** Every call the fake chat answers bills this, so a total is a known multiple of it. */
const CALL = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.0004 }
const CAPPED = { prompt_tokens: 90, completion_tokens: 40, total_tokens: 130, cost: 0.00018 }
const noSignal = () => new AbortController().signal
const roomy = () => 600_000

type Node = 'classify' | 'reply' | null

/** The fake chat, each answer billing CALL. The call of the node in `cut.node` stops at the token cap and bills CAPPED. */
function billing(options: Parameters<typeof fakeChat>[0], cut: { node: Node }): ChatFn {
  const base = fakeChat(options).getMockImplementation()!
  return vi.fn<ChatFn>(async (request, signal) => {
    const result = await base(request, signal)
    const node = request.messages[0].content.startsWith('You draft one short GitHub comment') ? 'reply' : 'classify'
    if (cut.node === node) return { ...result, finishReason: 'length', usage: CAPPED } satisfies ChatResult
    return { ...result, usage: CALL }
  })
}

function depsWith(chat: ChatFn, store: KeyValueStore = createMemoryStore()): RunDeps {
  return { store, storage: 'memory', chat, now: () => NOW }
}

/** A store whose writes to the spend record fail from the nth one on (1 = the first). */
function failingSpendWrites(from: number): KeyValueStore {
  const inner = createMemoryStore()
  let writes = 0
  return {
    ...inner,
    set: async (key, value) => {
      if (key.startsWith('spend/') && ++writes >= from) throw new Error('store write failed')
      return inner.set(key, value)
    },
  }
}

async function collect(work: (send: (event: StreamEvent) => void) => Promise<void>): Promise<{ events: StreamEvent[]; result: RunResult | undefined }> {
  const events: StreamEvent[] = []
  await work((event) => events.push(event))
  return { events, result: events.find((event): event is Extract<StreamEvent, { type: 'result' }> => event.type === 'result')?.result }
}

const start = (deps: RunDeps, issue = QUESTION) => collect((send) => startRun(deps, { issue, threadId: ID, budget: noSignal(), remainingMs: roomy, send }))

async function retry(deps: RunDeps) {
  const entry = (await inspectThread(deps, ID, undefined, { ownsClaim: true }))!.entry
  return collect((send) => retryRun(deps, { threadId: ID, entry, budget: noSignal(), remainingMs: roomy, send }))
}

async function approve(deps: RunDeps) {
  const entry = (await inspectThread(deps, ID, undefined, { ownsClaim: true }))!.entry
  return collect((send) => resumeRun(deps, { threadId: ID, entry, answer: { action: 'approve' }, budget: noSignal(), remainingMs: roomy, send }))
}

describe('P1: the classify call is capped, then Retry', () => {
  async function capped(store?: KeyValueStore) {
    const cut = { node: 'classify' as Node }
    const deps = depsWith(billing({}, cut), store)
    await start(deps)
    cut.node = null
    return deps
  }

  it('counts the failed attempt in the finished run: its cost is in the total, and the total is complete', async () => {
    const retried = await retry(await capped())
    // The capped classify, then classify and reply: three billed calls.
    expect(retried.result?.totals.cost).toBeCloseTo(CAPPED.cost + 2 * CALL.cost, 10)
    expect(retried.result?.totals.tokens).toBe(CAPPED.total_tokens + 2 * CALL.total_tokens)
    expect(retried.result?.totals.unreportedCalls).toBe(0)
    expect(formatTotalCost(retried.result!.totals)).not.toContain('at least')
  })

  it('shows the same total when the finished thread is opened again', async () => {
    const deps = await capped()
    const retried = await retry(deps)
    expect((await readThread(deps, ID))?.result?.totals).toEqual(retried.result?.totals)
  })

  it('shows what the failed attempt spent when the failed thread is opened, before any Retry', async () => {
    const view = await readThread(await capped(), ID)
    expect(view?.status).toBe('failed')
    const run = runFromView(view!)
    expect(totalsOf([...run.trace, ...run.spent])).toMatchObject({ tokens: CAPPED.total_tokens, unreportedCalls: 0 })
    expect(totalsOf([...run.trace, ...run.spent]).cost).toBeCloseTo(CAPPED.cost, 10)
  })

  it('keeps every failed attempt: two failures and then a success are three records in the total', async () => {
    const cut = { node: 'classify' as Node }
    const deps = depsWith(billing({}, cut))
    await start(deps)
    await retry(deps)
    cut.node = null
    const retried = await retry(deps)
    expect(retried.result?.totals.cost).toBeCloseTo(2 * CAPPED.cost + 2 * CALL.cost, 10)
  })
})

describe('P2: the reply is cut after Approve, then Retry', () => {
  it('counts the capped reply in the finished run', async () => {
    const cut = { node: null as Node }
    const deps = depsWith(billing({ classification: CLASSIFIED_BUG }, cut))
    await start(deps, BUG)
    cut.node = 'reply'
    const approved = await approve(deps)
    expect(approved.events.some((event) => event.type === 'error')).toBe(true)
    cut.node = null
    const retried = await retry(deps)
    // The classify, the capped reply, the good reply.
    expect(retried.result?.totals.cost).toBeCloseTo(2 * CALL.cost + CAPPED.cost, 10)
    expect(retried.result?.totals.unreportedCalls).toBe(0)
  })
})

describe('a failed attempt whose spend could not be saved', () => {
  it('reads "at least" in the finished run, because the failure left no record of what it billed', async () => {
    // The first write (the run opened) works; the one that records the failure does not.
    const cut = { node: 'classify' as Node }
    const deps = depsWith(billing({}, cut), failingSpendWrites(2))
    await start(deps)
    cut.node = null
    const retried = await retry(deps)
    expect(retried.result?.totals.unreportedCalls).toBeGreaterThanOrEqual(1)
    expect(formatTotalCost(retried.result!.totals)).toMatch(/^at least /)
  })

  it('reads "at least" when the failed thread is opened, too', async () => {
    const cut = { node: 'classify' as Node }
    const deps = depsWith(billing({}, cut), failingSpendWrites(2))
    await start(deps)
    const run = runFromView((await readThread(deps, ID))!)
    expect(totalsOf([...run.trace, ...run.spent]).unreportedCalls).toBeGreaterThanOrEqual(1)
  })

  it('does not call a clean run partial', async () => {
    const deps = depsWith(billing({}, { node: null }))
    const done = await start(deps)
    expect(done.result?.totals.unreportedCalls).toBe(0)
    expect((await readThread(deps, ID))?.result?.totals.unreportedCalls).toBe(0)
  })
})

describe('the live view across a Retry', () => {
  it('does not count the failed attempt twice when the page keeps its rows and then receives the result', async () => {
    const cut = { node: 'classify' as Node }
    const deps = depsWith(billing({}, cut))
    const first = await start(deps)
    cut.node = null
    const retried = await retry(deps)
    const view = [...first.events, ...retried.events].reduce(applyEvent, emptyRun())
    expect(view.result?.totals.cost).toBeCloseTo(CAPPED.cost + 2 * CALL.cost, 10)
  })
})
