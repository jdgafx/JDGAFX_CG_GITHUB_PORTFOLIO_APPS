import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergeFound } from '../../netlify/shared/duplicate-rank'
import type { StreamEvent } from '../../netlify/shared/events'
import { parseSearch, type SearchFn } from '../../netlify/shared/github-search'
import { MODEL } from '../../netlify/shared/models'
import { chat, PROVIDER_SLOW, PROVIDER_TIMEOUT, ProviderError, type ChatFn, type ChatResult } from '../../netlify/shared/openrouter'
import { startRun, type RunDeps } from '../../netlify/shared/run'
import { createMemoryStore } from '../../netlify/shared/store'
import { formatTotalCost, formatTotalTokens } from '../../src/lib/format'
import { applyEvent, emptyRun } from '../../src/lib/run-state'
import { totalsOf } from '../../src/lib/totals'
import type { RunTotals, TraceRow } from '../../src/types'
import { classificationText, fakeChat, providerResult } from '../helpers/fake-chat'
import { QUESTION, issue } from '../helpers/issues'
import recorded from '../fixtures/vscode-334721.json'

const NOW = new Date('2026-10-12T12:00:00Z')
const BILLED = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.0004 }
const OTHER = { prompt_tokens: 300, completion_tokens: 50, total_tokens: 350, cost: 0.0011 }
const timeout = () => new ProviderError(504, PROVIDER_TIMEOUT, 'timeout', false, { unreportedCalls: 1 })

/** A reply the provider billed, then stopped at the token cap. */
const cutOff = (text: string, usage: ChatResult['usage'] = BILLED): ChatResult => ({ ...providerResult(text, MODEL, usage), finishReason: 'length' })

/**
 * A chat that plays `script` for the calls in order: an Error is thrown, a ChatResult is returned, and 'ok' lets the
 * ordinary fake answer with usage that carries a cost. A call past the script is answered normally.
 */
function scripted(script: Array<Error | ChatResult | 'ok'>, options: Parameters<typeof fakeChat>[0] = {}) {
  const base = fakeChat(options)
  const answer = base.getMockImplementation()!
  return vi.fn<ChatFn>(async (request, signal) => {
    const step = script.shift() ?? 'ok'
    if (step instanceof Error) throw step
    if (step !== 'ok') return step
    const result = await answer(request, signal)
    return { ...result, usage: BILLED }
  })
}

interface Ran {
  events: StreamEvent[]
  rows: TraceRow[]
  totals: RunTotals
  failed: TraceRow | undefined
}

async function run(chat: ChatFn, deps: Partial<RunDeps> = {}, issueToRun = QUESTION): Promise<Ran> {
  const events: StreamEvent[] = []
  await startRun(
    { store: createMemoryStore(), storage: 'memory', chat, now: () => NOW, ...deps },
    { issue: issueToRun, threadId: 'billed', budget: new AbortController().signal, remainingMs: () => 60_000, send: (event) => events.push(event) },
  )
  const view = events.reduce(applyEvent, emptyRun())
  return { events, rows: view.trace, totals: totalsOf(view.trace), failed: view.trace.find((row) => row.status === 'failed') }
}

describe('a billed call is counted whatever became of its answer', () => {
  it('counts a classify reply cut off at the token cap: its row and the totals carry the tokens and the cost', async () => {
    const { failed, totals, events } = await run(scripted([cutOff(classificationText(undefined))]))
    expect(events.at(-1)).toMatchObject({ type: 'error' })
    expect(failed).toMatchObject({ node: 'classify', status: 'failed', usage: { total_tokens: 120 }, cost: 0.0004, costSource: 'usage' })
    expect(totals).toMatchObject({ tokens: 120, cost: 0.0004, unreportedCalls: 0 })
  })

  it('counts a reply draft cut off at the token cap on top of the classify call that came before it', async () => {
    const { failed, totals } = await run(scripted(['ok', cutOff('Thanks for the report.', OTHER)]))
    expect(failed).toMatchObject({ node: 'reply', status: 'failed', usage: { total_tokens: 350 }, cost: 0.0011 })
    expect(totals.tokens).toBe(470)
    expect(totals.cost).toBeCloseTo(0.0015, 10)
    expect(totals.unreportedCalls).toBe(0)
  })

  it('counts the replies that were empty or not JSON, which still continue the run', async () => {
    const empty = await run(scripted([providerResult('', MODEL, BILLED)]))
    expect(empty.rows.find((row) => row.node === 'classify')).toMatchObject({ status: 'failed', usage: { total_tokens: 120 }, cost: 0.0004 })
    const junk = await run(scripted([providerResult('not json at all', MODEL, BILLED)]))
    expect(junk.rows.find((row) => row.node === 'classify')).toMatchObject({ status: 'failed', usage: { total_tokens: 120 } })
    expect(junk.totals.tokens).toBeGreaterThanOrEqual(120)
  })

  describe('the duplicate judge', () => {
    const target = issue({ repo: 'microsoft/vscode', number: 334721, title: recorded.issue.title, body: recorded.issue.body, htmlUrl: 'https://github.com/microsoft/vscode/issues/334721' })
    const search: SearchFn = vi.fn(async () => mergeFound(parseSearch(recorded.strict), parseSearch(recorded.broad)))
    const bug = { type: 'bug', area: 'menubar', severity: 'low', confidence: 0.9, summary: 'The compact menu does not open.' } as const
    /** The graph pauses at review for this issue, so the run ends in an interrupt, not an error. */
    const judged = (script: Array<Error | ChatResult | 'ok'>, judge?: string) => scripted(script, { classification: bug, judge })

    it('counts a judge reply cut off at the token cap on the duplicates row, and still leaves the candidates without verdicts', async () => {
      const { rows, totals } = await run(judged(['ok', cutOff('{"verdicts": []}', OTHER)]), { search }, target)
      const duplicates = rows.find((row) => row.node === 'duplicates')
      expect(duplicates).toMatchObject({ status: 'failed', usage: { total_tokens: 350 }, cost: 0.0011 })
      // The triage goes on without verdicts, so the classify call, the cut-off judge and the reply all count.
      expect(totals.tokens).toBe(590)
      expect(totals.unreportedCalls).toBe(0)
    })

    it('shows a judge that failed before any usage arrived as not reported, and marks the totals partial', async () => {
      const { rows, totals, events } = await run(judged(['ok', new ProviderError(500, PROVIDER_SLOW, undefined, false, { unreportedCalls: 1 })]), { search }, target)
      const duplicates = rows.find((row) => row.node === 'duplicates')
      expect(duplicates).toMatchObject({ status: 'failed', unreportedCalls: 1 })
      expect(duplicates?.usage).toBeUndefined()
      expect(totals).toMatchObject({ tokens: 240, unreportedCalls: 1 })
      const report = events.find((event) => event.type === 'duplicates')
      expect(report).toMatchObject({ report: { status: 'unavailable' } })
    })

    it('counts nothing for a judge the provider refused with a 4xx, which bills nothing', async () => {
      const { rows, totals } = await run(judged(['ok', new ProviderError(400, 'The AI provider rejected the request.')]), { search }, target)
      expect(rows.find((row) => row.node === 'duplicates')).toMatchObject({ status: 'failed' })
      expect(totals).toMatchObject({ tokens: 240, unreportedCalls: 0 })
    })
  })

  describe('a retry', () => {
    it('counts the second attempt and marks the first, whose usage never arrived, as not reported', async () => {
      const { rows, totals } = await run(scripted([timeout(), 'ok', 'ok']))
      expect(rows.find((row) => row.node === 'classify')).toMatchObject({ status: 'ok', usage: { total_tokens: 120 }, unreportedCalls: 1 })
      expect(totals).toMatchObject({ tokens: 240, unreportedCalls: 1 })
      expect(formatTotalTokens(totals)).toBe('at least 240 (1 call not reported)')
    })

    it('shows two timeouts as two calls not reported, with no tokens and no cost invented', async () => {
      const { failed, totals } = await run(scripted([timeout(), timeout()]))
      expect(failed).toMatchObject({ node: 'classify', status: 'failed', unreportedCalls: 2 })
      expect(failed?.usage).toBeUndefined()
      expect(totals).toMatchObject({ tokens: null, cost: null, unreportedCalls: 2 })
      expect(formatTotalTokens(totals)).toBe('not reported')
      expect(formatTotalCost(totals)).toBe('not reported')
    })

    it('counts the cut-off second attempt and the first attempt that was not reported', async () => {
      const { failed, totals } = await run(scripted([timeout(), cutOff(classificationText(undefined), OTHER)]))
      expect(failed).toMatchObject({ node: 'classify', status: 'failed', usage: { total_tokens: 350 }, cost: 0.0011, unreportedCalls: 1 })
      expect(totals).toMatchObject({ tokens: 350, unreportedCalls: 1 })
      expect(formatTotalCost(totals)).toBe('at least $0.001100 (1 call not reported)')
    })

    it('keeps a good step before a later timeout in the totals, and marks them partial', async () => {
      const { totals, failed } = await run(scripted(['ok', timeout(), timeout()]))
      expect(failed).toMatchObject({ node: 'reply', unreportedCalls: 2 })
      expect(totals).toMatchObject({ tokens: 120, unreportedCalls: 2 })
    })
  })

  it('shows a call the run budget cut as not reported, with the totals of the steps before it', async () => {
    const budget = new AbortController()
    let calls = 0
    const chat: ChatFn = async (request, signal) => {
      calls += 1
      if (calls === 1) return { ...(await fakeChat().getMockImplementation()!(request, signal)), usage: BILLED }
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new ProviderError(504, PROVIDER_SLOW, 'budget', false, { unreportedCalls: 1 })))
        setTimeout(() => budget.abort(), 5)
      })
    }
    const events: StreamEvent[] = []
    await startRun(
      { store: createMemoryStore(), storage: 'memory', chat, now: () => NOW },
      { issue: QUESTION, threadId: 'budget-billed', budget: budget.signal, send: (event) => events.push(event) },
    )
    const view = events.reduce(applyEvent, emptyRun())
    const totals = totalsOf(view.trace)
    expect(view.trace.find((row) => row.status === 'failed')).toMatchObject({ node: 'reply', unreportedCalls: 1 })
    expect(totals).toMatchObject({ tokens: 120, unreportedCalls: 1 })
  })
})

describe('totals', () => {
  const row = (extra: Partial<TraceRow>): TraceRow => ({ node: 'classify', status: 'ok', ms: 10, detail: '', ...extra })

  it('sums what was reported and counts what was not, instead of hiding the sum', () => {
    const totals = totalsOf([
      row({ model: MODEL, usage: { total_tokens: 120 }, cost: 0.0004, costSource: 'usage' }),
      row({ node: 'reply', model: null }),
      row({ node: 'duplicates', unreportedCalls: 2 }),
    ])
    expect(totals).toMatchObject({ tokens: 120, cost: 0.0004, unreportedCalls: 3 })
  })

  it('is complete, with no call missing, when every model call reported', () => {
    const totals = totalsOf([row({ model: MODEL, usage: { total_tokens: 120 }, cost: 0.0004, costSource: 'usage' })])
    expect(totals.unreportedCalls).toBe(0)
    expect(formatTotalTokens(totals)).toBe('120')
    expect(formatTotalCost(totals)).toBe('$0.000400')
  })

  it('says "at least" for a partial total and pluralises the calls', () => {
    const totals = totalsOf([row({ model: MODEL, usage: { total_tokens: 1200 }, cost: 0.0012, costSource: 'usage', unreportedCalls: 2 })])
    expect(formatTotalTokens(totals)).toBe('at least 1,200 (2 calls not reported)')
    expect(formatTotalCost(totals)).toBe('at least $0.001200 (2 calls not reported)')
  })

  it('keeps an estimate labelled as an estimate', () => {
    const totals = totalsOf([row({ model: MODEL, usage: { total_tokens: 120 }, cost: 0.0004, costSource: 'estimated' })])
    expect(formatTotalCost(totals)).toBe('$0.000400 (estimated)')
  })
})


describe('which failed provider calls the chat function counts as not reported', () => {
  const request = { model: MODEL, messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 100 }
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    process.env.OPENROUTER_API_KEY = ''
  })

  async function failure(fetchStub: typeof fetch, signal: AbortSignal = new AbortController().signal): Promise<ProviderError> {
    process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
    vi.stubGlobal('fetch', fetchStub)
    const err = await chat(request, signal).catch((caught: unknown) => caught)
    expect(err).toBeInstanceOf(ProviderError)
    return err as ProviderError
  }

  it.each([
    ['a lost connection', async () => { throw new TypeError('fetch failed') }],
    ['a 5xx answer', async () => new Response('{}', { status: 503 })],
    ['a body that cannot be read', async () => new Response('not json', { status: 200 })],
  ])('counts %s as one call not reported', async (_name, stub) => {
    expect((await failure(stub as typeof fetch)).unreportedCalls).toBe(1)
  })

  it.each([
    ['a rejected key', 401],
    ['a rate limit', 429],
    ['a 4xx request error', 400],
  ])('counts %s as nothing billed', async (_name, status) => {
    expect((await failure((async () => new Response('{}', { status })) as typeof fetch)).unreportedCalls).toBe(0)
  })

  it('counts a call that passed its own limit as one call not reported', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const pending = chat(request, new AbortController().signal).catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(13_000)
    expect(await pending).toMatchObject({ kind: 'timeout', unreportedCalls: 1 })
  })

  it('counts a call the run budget cut as one call not reported', async () => {
    process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const budget = new AbortController()
    const pending = chat(request, budget.signal).catch((caught: unknown) => caught)
    budget.abort()
    expect(await pending).toMatchObject({ kind: 'budget', unreportedCalls: 1 })
  })
})
