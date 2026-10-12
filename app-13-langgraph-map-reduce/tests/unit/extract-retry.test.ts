import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { splitText } from '../../netlify/shared/chunk'
import { ProviderError } from '../../netlify/shared/errors'
import { MIN_EXTRACT_RETRY_BUDGET_MS, MODEL, RETRY_CALL_TIMEOUT_MS, RETRY_PAUSE_MS } from '../../netlify/shared/models'
import { RUN_BUDGET_MS } from '../../netlify/shared/pipeline'
import type { ChatFn, ChatReply, ChatRequest } from '../../netlify/shared/openrouter'
import { missingItems } from '../../src/lib/coverage-text'
import { metricsFor } from '../../src/lib/metrics'
import type { Frame, RunResult, TraceRow } from '../../src/types/frames'
import { attributionText } from '../helpers/attribute'
import { roleOf } from '../helpers/roles'
import { FixedBudget, runSplit } from '../helpers/split'

// Request 1 has a 23 s budget and its extract phase took 2.9 to 7.3 s in live runs, so when a chunk's extract comes back with
// nothing usable it retries that chunk once, as long as the retry fits what is left of request 1.

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

type Answer = ChatReply | ProviderError

/** Healthy replies, except that `bad(chunk, attempt)` can replace an extract answer. */
function chat(bad: (chunk: number, attempt: number) => Answer | undefined, seen: ChatRequest[] = []): ChatFn {
  const attempts = new Map<number, number>()
  return async (request) => {
    seen.push(request)
    const user = lastMessage(request)
    const role = roleOf(request)
    if (role === 'extract') {
      const chunk = chunkOf(user)
      const attempt = (attempts.get(chunk) ?? 0) + 1
      attempts.set(chunk, attempt)
      const answer = bad(chunk, attempt)
      if (answer instanceof ProviderError) throw answer
      return answer ?? reply(JSON.stringify({ points: [`Chunk ${chunk} rule.`, `Chunk ${chunk} detail.`], entities: [] }))
    }
    if (role === 'attribute') return reply(attributionText(user))
    if (role === 'check') return reply(JSON.stringify({ important: [] }))
    const ids = [...new Set([...user.matchAll(/\[chunk (\d+)\]/g)].map((m) => Number(m[1])))]
    // Sections of three sentences: a section holds at most six, and the r1 text has nine chunks.
    const sections = Array.from({ length: Math.ceil(ids.length / 3) }, (_, i) => ({ heading: `Part ${i + 1}`, points: ids.slice(i * 3, i * 3 + 3).map((id) => ({ text: `Rule ${id}.`, chunks: [id] })) }))
    return reply(JSON.stringify({ overview: 'A lease.', sections }))
  }
}

const rowsOf = (frames: Frame[]): TraceRow[] => frames.filter((f): f is Extract<Frame, { type: 'node_end' }> => f.type === 'node_end')
const extractRows = (frames: Frame[], chunk: number): TraceRow[] => rowsOf(frames).filter((r) => r.node === 'extract' && r.chunk === chunk)

describe('request 1 retries a chunk whose extract came back with nothing usable', () => {
  it.each([
    ['without key points', reply('{"points": [], "entities": []}'), true],
    ['not JSON', reply('I cannot do that.'), true],
    ['empty', reply(''), true],
    ['cut off at the token cap', reply('{"points": ["Cut', { finishReason: 'length' }), true],
    ['not answered in time', new ProviderError('timeout'), false],
  ])('a chunk whose first reply is %s is asked again once, and the hand-off carries it', async (_name, first, billed) => {
    const seen: ChatRequest[] = []
    const run = await runSplit(THREE, chat((chunk, attempt) => (chunk === 2 && attempt === 1 ? first : undefined), seen))

    const attempts = extractRows(run.first, 2)
    expect(attempts.map((r) => r.status)).toEqual(['failed', 'ok'])
    expect(attempts[1]?.detail).toBe('chunk 2 of 3 (retry)')
    // The retry happens in request 1: the hand-off holds chunk 2, so request 2 has nothing to retry.
    expect(run.merged?.byChunk.map((c) => c.chunkId)).toEqual([1, 2, 3])
    expect(seen.filter((r) => roleOf(r) === 'extract')).toHaveLength(4)
    expect(run.first.some((f) => f.type === 'edge' && f.from === 'reduce' && f.to === 'extract' && f.label === 'retry 1 chunk that gave no key points')).toBe(true)
    const result = run.results[0] as RunResult
    expect(result.coverage.missing).toEqual([])
    expect(missingItems(result.coverage)).toEqual([])
    expect(result.retryOutcome).toBe('used')
    expect(result.retries).toBe(1)
    // C13: both attempts count. The first was billed unless it never answered, in which case it is not reported.
    if (billed) expect(attempts[0]?.usage?.total_tokens).toBe(CALL_TOKENS)
    else expect(attempts[0]?.usage).toBeUndefined()
    const metrics = metricsFor(rowsOf(run.frames), 0)
    expect(metrics.unreportedCalls).toBe(billed ? 0 : 1)
    expect(metrics.totalTokens).toBe(rowsOf(run.frames).filter((r) => r.usage).length * CALL_TOKENS)
    expect(rowsOf(run.frames).filter((r) => r.node === 'extract' && r.usage)).toHaveLength(billed ? 4 : 3)
  })

  it('asks only once: a chunk that fails again stays missing, and request 2 reports it', async () => {
    const seen: ChatRequest[] = []
    const run = await runSplit(THREE, chat((chunk) => (chunk === 2 ? reply('{"points": []}') : undefined), seen))

    expect(seen.filter((r) => roleOf(r) === 'extract' && chunkOf(lastMessage(r)) === 2)).toHaveLength(2)
    expect(run.merged?.byChunk.map((c) => c.chunkId)).toEqual([1, 3])
    const result = run.results[0] as RunResult
    expect(result.coverage.noPoints).toEqual([2])
    // Request 1 spent the one retry, so request 2 does not ask a third time; it reports the chunk as still missing after the retry.
    expect(result.retryOutcome).toBe('used')
    expect(result.retries).toBe(1)
    for (const row of extractRows(run.first, 2)) expect(row.usage?.total_tokens).toBe(CALL_TOKENS)
  })

  it('retries every empty chunk together, and none when all are fine', async () => {
    const some = await runSplit(THREE, chat((chunk, attempt) => (chunk !== 2 && attempt === 1 ? reply('{"points": []}') : undefined)))
    expect(some.first.some((f) => f.type === 'edge' && f.label === 'retry 2 chunks that gave no key points')).toBe(true)
    expect(some.merged?.byChunk.map((c) => c.chunkId)).toEqual([1, 2, 3])

    const none = await runSplit(THREE, chat(() => undefined))
    expect(none.first.some((f) => f.type === 'edge' && f.from === 'reduce')).toBe(false)
    expect((none.results[0] as RunResult).retryOutcome).toBe('none')
  })

  it('retries only when the retry fits what is left of request 1: the pause, the retry call limit and a margin', async () => {
    expect(MIN_EXTRACT_RETRY_BUDGET_MS).toBe(RETRY_PAUSE_MS + RETRY_CALL_TIMEOUT_MS + 1_000)
    const bad = (chunk: number, attempt: number): Answer | undefined => (chunk === 2 && attempt === 1 ? reply('{"points": []}') : undefined)

    const tight = await runSplit(THREE, chat(bad), { budgetFirst: new FixedBudget(MIN_EXTRACT_RETRY_BUDGET_MS - 1) })
    expect(extractRows(tight.first, 2)).toHaveLength(1)
    expect(tight.merged?.byChunk.map((c) => c.chunkId)).toEqual([1, 3])

    const fits = await runSplit(THREE, chat(bad), { budgetFirst: new FixedBudget(MIN_EXTRACT_RETRY_BUDGET_MS) })
    expect(extractRows(fits.first, 2)).toHaveLength(2)
    expect(fits.merged?.byChunk.map((c) => c.chunkId)).toEqual([1, 2, 3])
  })

  it('is measured against the live extract phase: request 1 used 7.3 s at most, which leaves room', () => {
    expect(RUN_BUDGET_MS - 7_280).toBeGreaterThanOrEqual(MIN_EXTRACT_RETRY_BUDGET_MS)
  })
})

describe('the r1 case: chunk 1 came back with no key points and the summary lost the July 20 landing', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/r1-apollo-chunk1.json', 'utf8')) as { text: string; chunkOnePoints: string[] }
  const chunkCount = splitText(fixture.text).length

  /** Chunk 1 answers with nothing the first time and with its real key points the second; every other chunk answers once. */
  function r1Chat(): ChatFn {
    const base = chat(() => undefined)
    let tries = 0
    return async (request, signal) => {
      if (roleOf(request) === 'extract' && chunkOf(lastMessage(request)) === 1) {
        tries += 1
        return tries === 1 ? reply('{"points": [], "entities": []}') : reply(JSON.stringify({ points: fixture.chunkOnePoints, entities: [] }))
      }
      return base(request, signal)
    }
  }

  it('gets chunk 1 on the second attempt in request 1, so request 2 summarizes all the chunks', async () => {
    expect(chunkCount).toBe(9)
    const run = await runSplit(fixture.text, r1Chat())

    expect(run.merged?.byChunk[0]?.points.map((p) => p.text)).toEqual(fixture.chunkOnePoints)
    expect(run.merged?.byChunk).toHaveLength(9)
    const result = run.results[0] as RunResult
    expect(result.coverage).toMatchObject({ missing: [], noPoints: [] })
    expect(result.coverage.covered).toHaveLength(9)
    expect(result.retryOutcome).toBe('used')
    expect(result.notice).toBeNull()
  })

  it('without the retry the chunk stays missing, as in the live run', async () => {
    // Request 2 has about 9 s left after its synthesis, too little for the 17 s a retry needs there: as in the live run.
    const run = await runSplit(fixture.text, r1Chat(), { budgetFirst: new FixedBudget(MIN_EXTRACT_RETRY_BUDGET_MS - 1), budgetSecond: new FixedBudget(9_000) })
    const result = run.results[0] as RunResult

    expect(result.coverage.noPoints).toEqual([1])
    expect(missingItems(result.coverage)).toEqual(['chunk 1 (no key points found)'])
  })
})
