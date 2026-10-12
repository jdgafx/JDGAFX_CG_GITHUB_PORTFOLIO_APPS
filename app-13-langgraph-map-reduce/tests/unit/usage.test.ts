import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProviderError } from '../../netlify/shared/errors'
import { ATTRIBUTE, CHECK, EXTRACT, MODEL, SYNTH } from '../../netlify/shared/models'
import type { ChatFn, ChatReply, ChatRequest } from '../../netlify/shared/openrouter'
import { ReadoutStrip } from '../../src/components/ReadoutStrip'
import { TracePanel } from '../../src/components/TracePanel'
import { metricsFor } from '../../src/lib/metrics'
import { applyFrame, initialView, type RunView } from '../../src/lib/view'
import type { Frame, RunResult, TraceRow } from '../../src/types/frames'
import { attributionText } from '../helpers/attribute'
import { roleOf, type Role } from '../helpers/roles'
import { runSplit, type SplitRun } from '../helpers/split'

// Failure class C13: every call OpenRouter answered with a usage block counts in the run's totals and in its own row,
// whatever became of its content. A call whose usage cannot be known (no reply arrived) says "not reported" in its row, and the
// total says it is partial. Totals are shown when a run fails too. Every test here runs the analysis as production does: request 1
// extracts and signs, request 2 writes and checks, and the page adds the rows of both.

const paragraph = (n: number): string => Array.from({ length: 120 }, (_, i) => `term${n}w${i}`).join(' ') + '.'
const THREE = [1, 2, 3].map(paragraph).join('\n')
const CALL_TOKENS = 1_200

const reply = (text: string, over: Partial<ChatReply> = {}): ChatReply => ({
  text,
  finishReason: 'stop',
  servedModel: MODEL,
  usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: CALL_TOKENS },
  ...over,
})
const lastMessage = (request: ChatRequest): string => request.messages[request.messages.length - 1]?.content ?? ''
const chunkOf = (user: string): number => Number(/^Chunk (\d+) of/.exec(user)?.[1])

/** What each role answers when the test does not say otherwise: two points per chunk, a summary stating the first of each. */
function healthy(request: ChatRequest): ChatReply {
  const user = lastMessage(request)
  const role = roleOf(request)
  if (role === 'extract') return reply(JSON.stringify({ points: [`Chunk ${chunkOf(user)} rule.`, `Chunk ${chunkOf(user)} detail.`], entities: [] }))
  if (role === 'attribute') return reply(attributionText(user))
  if (role === 'check') return reply(JSON.stringify({ important: [] }))
  const ids = [...new Set([...user.matchAll(/\[chunk (\d+)\]/g)].map((m) => Number(m[1])))]
  return reply(JSON.stringify({ overview: 'A lease.', sections: [{ heading: 'Terms', points: ids.map((id) => ({ text: `Rule ${id}.`, chunks: [id] })) }] }))
}

type Answer = ChatReply | ProviderError
/** `on(role, nth call of that role)` returns what to answer instead of the healthy reply, or undefined to keep it. */
function scripted(on: (role: Role, nth: number, request: ChatRequest) => Answer | undefined): ChatFn {
  const counts = new Map<Role, number>()
  return async (request) => {
    const role = roleOf(request)
    const nth = (counts.get(role) ?? 0) + 1
    counts.set(role, nth)
    const answer = on(role, nth, request) ?? healthy(request)
    if (answer instanceof ProviderError) throw answer
    return answer
  }
}

const rowsOf = (frames: Frame[]): TraceRow[] => frames.filter((f): f is Extract<Frame, { type: 'node_end' }> => f.type === 'node_end')
const viewOf = (frames: Frame[]): RunView => frames.reduce(applyFrame, { ...initialView(), phase: 'running' as const })
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')
const readout = (frames: Frame[]): string => text(renderToStaticMarkup(createElement(ReadoutStrip, { view: viewOf(frames) })))

/** The failed row of a node, which carries the billed usage of a call whose reply was refused. */
const failedRow = (frames: Frame[], node: string, chunk?: number): TraceRow => {
  const row = rowsOf(frames).find((r) => r.node === node && r.status === 'failed' && (chunk === undefined || r.chunk === chunk))
  if (!row) throw new Error(`no failed ${node} row`)
  return row
}
const expectBilled = (row: TraceRow): void => {
  expect(row.usage?.total_tokens).toBe(CALL_TOKENS)
  expect(row.priceState).toBe('priced')
  expect(row.cost).toBeGreaterThan(0)
}
const expectNotReported = (row: TraceRow, model: string): void => {
  expect(row.model).toBe(model)
  expect(row.usage).toBeUndefined()
  expect(row.priceState).toBeUndefined()
  expect(row.cost).toBeUndefined()
}
const cut = (): ChatReply => reply('{"overview": "cut', { finishReason: 'length' })

describe('metricsFor counts a call that never answered as not reported, and keeps the rest of the total', () => {
  const answered: TraceRow = { node: 'extract', status: 'ok', ms: 5, detail: 'chunk 1 of 2', chunk: 1, model: MODEL, servedModel: 'anthropic/claude-haiku-5.5', usage: { total_tokens: 1000 }, priceState: 'priced', cost: 0.2 }
  const lost: TraceRow = { node: 'extract', status: 'failed', ms: 5, detail: 'chunk 2 of 2', chunk: 2, model: MODEL, message: 'The AI provider did not answer in time.' }
  const notMade: TraceRow = { node: 'extract', status: 'failed', ms: 0, detail: 'chunk 3 of 3', chunk: 3, message: 'Stopped because another call in this run failed.' }

  it('counts rows that name a model but carry no reply', () => {
    expect(metricsFor([answered, lost], 9)).toMatchObject({ unreportedCalls: 1, totalTokens: 1000, totalCost: 0.2 })
    expect(metricsFor([answered], 9).unreportedCalls).toBe(0)
  })

  it('does not count a call that was never made', () => {
    expect(metricsFor([answered, notMade], 9).unreportedCalls).toBe(0)
  })
})

describe('request 2: the writer', () => {
  it.each([
    ['cut off at the token cap', cut()],
    ['not JSON', reply('Sure, here is the summary you asked for.')],
    ['empty', reply('')],
    ['JSON with no sections', reply('{"overview": "A lease.", "sections": []}')],
  ])('a summary reply that is %s is billed: its row and the totals include it, and the run says why it failed', async (_name, answer) => {
    const run = await runSplit(THREE, scripted((role) => (role === 'synthesize' ? answer : undefined)))

    expect(run.errors).toHaveLength(1)
    const row = failedRow(run.frames, 'synthesize')
    expect(row.model).toBe(SYNTH.model)
    expectBilled(row)
    expect(row.message).toBeTruthy()
    // 3 extract calls and the refused summary: all billed, and shown although the run failed.
    expect(metricsFor(rowsOf(run.frames), 0)).toMatchObject({ totalTokens: 4 * CALL_TOKENS, unreportedCalls: 0 })
    expect(readout(run.frames)).toContain('4,800')
    expect(readout(run.frames)).not.toContain('not reported')
  })

  it('a summary call that times out is shown as not reported, and the total says it is partial', async () => {
    const run = await runSplit(THREE, scripted((role) => (role === 'synthesize' ? new ProviderError('timeout') : undefined)))

    expect(run.errors).toEqual(['The AI provider did not answer in time.'])
    expectNotReported(failedRow(run.frames, 'synthesize'), SYNTH.model)
    expect(metricsFor(rowsOf(run.frames), 0)).toMatchObject({ unreportedCalls: 1, totalTokens: 3 * CALL_TOKENS })
    expect(readout(run.frames)).toMatch(/at least \$[\d.]+ \(1 call not reported\)/)
    expect(readout(run.frames)).toContain('at least 3,600')
  })

  it('shows the totals of both requests when request 2 fails, with the rows of request 1 in them', async () => {
    const run = await runSplit(THREE, scripted((role) => (role === 'synthesize' ? cut() : undefined)))
    const view = viewOf(run.frames)

    expect(view.phase).toBe('error')
    expect(view.rows.filter((r) => r.node === 'extract')).toHaveLength(3)
    expect(text(renderToStaticMarkup(createElement(TracePanel, { view })))).toContain('1,200 tok')
    expect(readout(run.frames)).toContain('4,800')
  })
})

describe('request 1: the extract calls', () => {
  it.each([
    ['cut off at the token cap', cut()],
    ['not JSON', reply('I cannot do that.')],
    ['empty', reply('')],
    ['without key points', reply('{"points": [], "entities": []}')],
  ])('a chunk whose reply is %s is billed in its row and in the totals', async (_name, answer) => {
    const run = await runSplit(THREE, scripted((role, _nth, request) => (role === 'extract' && chunkOf(lastMessage(request)) === 2 ? answer : undefined)))

    // Chunk 2 is missing, and request 2 asks for it again with the same answer: both attempts are billed rows.
    const attempts = rowsOf(run.frames).filter((r) => r.node === 'extract' && r.chunk === 2)
    expect(attempts).toHaveLength(2)
    for (const row of attempts) expectBilled(row)
    const result = run.results[0] as RunResult
    expect(result.coverage.noPoints).toEqual([2])
    expect(result.metrics.unreportedCalls).toBe(0)
    // Every row with a usage block is in the total, the failed ones included: 3 extracts, the retry, the writer, 2 key point checks, the review.
    const billed = rowsOf(run.frames).filter((r) => r.usage)
    expect(billed).toHaveLength(8)
    expect(result.metrics.totalTokens).toBe(8 * CALL_TOKENS)
  })

  it('a chunk that times out is shown as not reported, and the total of a finished run says it is partial', async () => {
    const run = await runSplit(THREE, scripted((role, _nth, request) => (role === 'extract' && chunkOf(lastMessage(request)) === 2 ? new ProviderError('timeout') : undefined)))

    // Request 1's attempt and request 2's retry both got no reply.
    const attempts = rowsOf(run.frames).filter((r) => r.node === 'extract' && r.chunk === 2)
    expect(attempts).toHaveLength(2)
    for (const row of attempts) expectNotReported(row, EXTRACT.model)
    const result = run.results[0] as RunResult
    expect(result.metrics.unreportedCalls).toBe(2)
    expect(result.metrics.totalCost).toBeGreaterThan(0)
    expect(readout(run.frames)).toMatch(/at least \$[\d.]+ \(2 calls not reported\)/)
  })

  it('counts every attempt of a retry: the billed first attempt and the billed second one', async () => {
    const run = await runSplit(THREE, scripted((role, nth, request) => (role === 'extract' && chunkOf(lastMessage(request)) === 2 && nth <= 3 && nth === 2 ? cut() : undefined)))
    const attempts = rowsOf(run.frames).filter((r) => r.node === 'extract' && r.chunk === 2)

    expect(attempts.map((r) => r.status)).toEqual(['failed', 'ok'])
    for (const row of attempts) expectBilled(row)
    const result = run.results[0] as RunResult
    expect(result.retryOutcome).toBe('used')
    // 3 extracts + the retry's extract, the writer, 3 key point checks and the review, each twice for the second pass.
    expect(result.metrics.totalTokens).toBe(rowsOf(run.frames).filter((r) => r.usage).length * CALL_TOKENS)
    expect(result.metrics.totalTokens).toBeGreaterThanOrEqual(9 * CALL_TOKENS)
  })

  it('counts a billed first attempt and a second attempt that never answered, on a retry that fails', async () => {
    let attempt = 0
    const run = await runSplit(
      THREE,
      scripted((role, _nth, request) => {
        if (role !== 'extract' || chunkOf(lastMessage(request)) !== 2) return undefined
        attempt += 1
        return attempt === 1 ? reply('{"points": []}') : new ProviderError('timeout')
      }),
    )
    const attempts = rowsOf(run.frames).filter((r) => r.node === 'extract' && r.chunk === 2)

    expect(attempts).toHaveLength(2)
    expectBilled(attempts[0]!)
    expectNotReported(attempts[1]!, EXTRACT.model)
    expect((run.results[0] as RunResult).metrics.unreportedCalls).toBe(1)
  })
})

describe('request 2: the key point check and the review', () => {
  it('a key point check call that times out is not reported, the one cut off is billed, and the totals say partial', async () => {
    const run = await runSplit(
      THREE,
      scripted((role, nth) => (role === 'attribute' ? (nth === 1 ? new ProviderError('timeout') : nth === 2 ? reply('{"states": []}', { finishReason: 'length' }) : undefined) : undefined)),
    )

    const failed = rowsOf(run.frames).filter((r) => r.node === 'check' && r.chunk !== undefined && r.status === 'failed')
    expect(failed).toHaveLength(2)
    expect(failed.filter((r) => r.usage === undefined)).toHaveLength(1)
    expectNotReported(failed.find((r) => r.usage === undefined)!, ATTRIBUTE.model)
    expectBilled(failed.find((r) => r.usage !== undefined)!)
    expect((run.results[0] as RunResult).metrics.unreportedCalls).toBe(1)
  })

  it('a review that times out is not reported, one that is not JSON is billed', async () => {
    const lost = await runSplit(THREE, scripted((role) => (role === 'check' ? new ProviderError('timeout') : undefined)))
    expectNotReported(failedRow(lost.frames, 'check'), CHECK.model)
    expect((lost.results[0] as RunResult).metrics.unreportedCalls).toBe(1)

    const unreadable = await runSplit(THREE, scripted((role) => (role === 'check' ? reply('looks fine to me') : undefined)))
    expectBilled(failedRow(unreadable.frames, 'check'))
    expect((unreadable.results[0] as RunResult).metrics.unreportedCalls).toBe(0)
  })
})

export type { SplitRun }
