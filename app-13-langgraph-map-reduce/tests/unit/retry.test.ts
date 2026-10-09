import { describe, expect, it, vi } from 'vitest'
import { RunBudget } from '../../netlify/shared/budget'
import { ProviderError } from '../../netlify/shared/errors'
import { CHECK_CALL_TIMEOUT_MS, EXTRACT_CALL_TIMEOUT_MS, MODEL, RETRY_CALL_TIMEOUT_MS } from '../../netlify/shared/models'
import { isCheck, isExtract } from '../helpers/roles'
import type { ChatFn, ChatReply, ChatRequest } from '../../netlify/shared/openrouter'
import { CUT_OFF_MESSAGE, KEPT_FIRST_PASS, runPipeline } from '../../netlify/shared/pipeline'
import type { Frame, RunResult } from '../../src/types/frames'

/** One paragraph of about 1,000 characters. Two cannot share a 1,200 character chunk, so N paragraphs make N chunks. */
const paragraph = (n: number): string => Array.from({ length: 120 }, (_, i) => `term${n}w${i}`).join(' ') + '.'
const document = (count: number): string => Array.from({ length: count }, (_, i) => paragraph(i + 1)).join('\n')
const THREE = document(3)
const FIVE = document(5)

const reply = (text: string, model: string): ChatReply => ({
  text,
  finishReason: 'stop',
  servedModel: model,
  usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
  cost: null,
})
const lastMessage = (request: ChatRequest): string => request.messages[request.messages.length - 1]?.content ?? ''
const chunkOf = (user: string): number => Number(/^Chunk (\d+) of/.exec(user)?.[1])
const citedIds = (user: string): number[] => [...new Set([...user.matchAll(/\[chunk (\d+)\]/g)].map((m) => Number(m[1])))]
const extractReply = (id: number): ChatReply =>
  reply(JSON.stringify({ points: [`Chunk ${id} states its rule.`], entities: ['The Lessor'] }), MODEL)
const synthReply = (ids: number[], overview = 'First pass summary.'): ChatReply =>
  reply(
    JSON.stringify({
      overview,
      sections: [{ heading: 'Terms', points: ids.map((id) => ({ text: `Rule ${id} holds.`, chunks: [id] })) }],
    }),
    MODEL,
  )
const review = (omitted: number[]): ChatReply => reply(JSON.stringify({ omitted }), MODEL)

interface Script {
  /** chunk id -> number of extract calls that time out before one succeeds */
  failExtract?: Record<number, number>
  /** the review flags these chunks on every check */
  flags?: number[]
  /** the summary cites only these chunks, whatever it is given */
  cite?: number[]
  /** the second synthesis call cites only these chunks (its overview reads 'Second pass summary.') */
  citeSecond?: number[]
  /** the second synthesis call fails with a timeout */
  failSecondSynthesis?: boolean
}

interface Seen {
  extractRequests: Array<{ chunk: number; timeoutMs: number | undefined }>
  synthCalls: number
  checkCalls: number
  checkTimeouts: Array<number | undefined>
}

function scripted(script: Script, seen: Seen): ChatFn {
  const attempts = new Map<number, number>()
  return async (request) => {
    const user = lastMessage(request)
    if (isExtract(request)) {
      const id = chunkOf(user)
      seen.extractRequests.push({ chunk: id, timeoutMs: request.timeoutMs })
      attempts.set(id, (attempts.get(id) ?? 0) + 1)
      if ((attempts.get(id) ?? 0) <= (script.failExtract?.[id] ?? 0)) throw new ProviderError('timeout')
      return extractReply(id)
    }
    if (isCheck(request)) {
      seen.checkCalls += 1
      seen.checkTimeouts.push(request.timeoutMs)
      return review(script.flags ?? [])
    }
    seen.synthCalls += 1
    if (script.failSecondSynthesis && seen.synthCalls > 1) throw new ProviderError('timeout')
    if (script.citeSecond && seen.synthCalls > 1) return synthReply(script.citeSecond, 'Second pass summary.')
    return synthReply(script.cite ?? citedIds(user))
  }
}

async function run(source: string, script: Script, budget: RunBudget = new RunBudget(60_000)) {
  const seen: Seen = { extractRequests: [], synthCalls: 0, checkCalls: 0, checkTimeouts: [] }
  const frames: Frame[] = []
  try {
    await runPipeline({ text: source, budget, chat: scripted(script, seen), retryPauseMs: 0, sink: (f) => frames.push(f) })
  } finally {
    budget.dispose()
  }
  const results = frames.flatMap((f) => (f.type === 'result' ? [f.result] : []))
  return { frames, seen, result: results[0] as RunResult | undefined, errors: frames.filter((f) => f.type === 'error') }
}

const edgeLabels = (frames: Frame[]): string[] => frames.flatMap((f) => (f.type === 'edge' ? [f.label] : []))

describe('the review is advisory', () => {
  it('keeps chunks the summary cites covered, starts no retry and carries the flags as a note', async () => {
    const { result, seen, frames } = await run(THREE, { flags: [2, 3] })

    expect(result).toMatchObject({
      coverage: { covered: [1, 2, 3], missing: [], noPoints: [] },
      reviewFlags: [2, 3],
      retries: 0,
      notice: null,
    })
    expect(seen.extractRequests).toHaveLength(3)
    expect(seen.synthCalls).toBe(1)
    expect(edgeLabels(frames)).toContain('coverage complete')
  })

  it('ignores a flag on a chunk that is already missing, so the note never repeats the alert', async () => {
    const { result } = await run(THREE, { flags: [2], cite: [1, 3], failExtract: {} })

    expect(result?.coverage).toEqual({ covered: [1, 3], missing: [2], noPoints: [] })
    expect(result?.reviewFlags).toEqual([])
  })

  it('names a chunk the summary does not cite as missing for that reason, not as one without key points', async () => {
    const { result } = await run(THREE, { cite: [1, 2] })

    expect(result?.coverage).toEqual({ covered: [1, 2], missing: [3], noPoints: [] })
  })
})

describe('the retry pass is held to a shorter call limit', () => {
  it('gives first-pass extract calls 6 s and the retry pass extract calls 5 s', async () => {
    expect(EXTRACT_CALL_TIMEOUT_MS).toBe(6_000)
    expect(RETRY_CALL_TIMEOUT_MS).toBe(5_000)

    const { seen } = await run(THREE, { failExtract: { 2: 1 } })

    const second = seen.extractRequests.filter((r) => r.chunk === 2)
    expect(second.map((r) => r.timeoutMs)).toEqual([6_000, 5_000])
    expect(seen.extractRequests.filter((r) => r.chunk !== 2).every((r) => r.timeoutMs === 6_000)).toBe(true)
  })

  it('holds the advisory review call to 5 s, and leaves the synthesis call to the 10 s default', async () => {
    expect(CHECK_CALL_TIMEOUT_MS).toBe(5_000)

    const { seen } = await run(THREE, {})

    expect(seen.checkTimeouts).toEqual([5_000])
  })

  it('uses the singular in the loop label for one missing chunk and the plural for two', async () => {
    const one = await run(THREE, { failExtract: { 2: 1 } })
    const two = await run(THREE, { failExtract: { 2: 1, 3: 1 } })

    expect(edgeLabels(one.frames)).toContain('retry 1 missing chunk')
    expect(edgeLabels(two.frames)).toContain('retry 2 missing chunks')
  })
})

describe('a retry that cannot help keeps the first-pass summary', () => {
  it('skips the second synthesis and check when the retry found nothing new', async () => {
    const { result, seen, frames } = await run(THREE, { failExtract: { 2: 9 } })

    expect(seen.synthCalls).toBe(1)
    expect(seen.checkCalls).toBe(1)
    expect(result).toMatchObject({
      coverage: { covered: [1, 3], missing: [2], noPoints: [2] },
      retries: 1,
      notice: '1 chunk still missing after the retry. The summary is from the first pass.',
    })
    expect(edgeLabels(frames)).toContain('1 chunk still missing after the retry')
    const final = frames.find((f) => f.type === 'node_end' && f.node === 'final')
    expect(final).toMatchObject({ status: 'ok', detail: expect.stringContaining(KEPT_FIRST_PASS) })
  })

  it('still runs the second synthesis when the retry found a new key point', async () => {
    const { result, seen } = await run(THREE, { failExtract: { 2: 1 } })

    expect(seen.synthCalls).toBe(2)
    expect(result).toMatchObject({ coverage: { missing: [] }, retries: 1, notice: null })
  })

  it('skips the second synthesis with the time-limit notice when under 6 s remain after the retry', async () => {
    const budget = new RunBudget(60_000)
    let retryStarted = false
    vi.spyOn(budget, 'remaining').mockImplementation(() => (retryStarted ? 5_000 : 20_000))
    const seen: Seen = { extractRequests: [], synthCalls: 0, checkCalls: 0, checkTimeouts: [] }
    const inner = scripted({ failExtract: { 2: 1 } }, seen)
    const chat: ChatFn = async (request, signal) => {
      if (request.timeoutMs !== undefined) retryStarted = true
      return inner(request, signal)
    }
    const frames: Frame[] = []
    await runPipeline({ text: THREE, budget, chat, retryPauseMs: 0, sink: (f) => frames.push(f) })
    budget.dispose()

    const result = frames.flatMap((f) => (f.type === 'result' ? [f.result] : []))[0]
    expect(seen.synthCalls).toBe(1)
    expect(result?.notice).toBe('The coverage retry was skipped to stay inside the time limit.')
    expect(edgeLabels(frames)).toContain('1 chunk still missing, retry skipped for time')
  })

  it('words a retry that timed out without telling the reader to shorten the text', async () => {
    const { result } = await run(THREE, { failExtract: { 2: 1 }, failSecondSynthesis: true })

    expect(result?.notice).toBe('The retry did not finish in time, so the summary is from the first pass.')
    expect(result?.notice).not.toContain('shorter')
  })
})

describe('the retry never lowers coverage', () => {
  // Chunk 2 times out once, so the first summary cites 1 and 3 (2 of 3). The retry brings chunk 2 back.
  const first = { failExtract: { 2: 1 } }

  it('keeps the second summary when it covers more chunks', async () => {
    const { result } = await run(THREE, { ...first })

    expect(result).toMatchObject({ coverage: { covered: [1, 2, 3], missing: [] }, notice: null, retries: 1 })
    expect(result?.summary.overview).toBe('First pass summary.')
  })

  it('keeps the first summary when the second covers fewer chunks, and says so in the notice and the trace', async () => {
    const { result, frames } = await run(THREE, { ...first, citeSecond: [2] })

    expect(result?.summary.overview).toBe('First pass summary.')
    expect(result?.coverage).toEqual({ covered: [1, 3], missing: [2], noPoints: [2] })
    expect(result?.notice).toBe('The retry pass covered 1 of 3 chunks against 2 of 3 in the first pass, so the first-pass summary is kept.')
    const check = frames.filter((f) => f.type === 'node_end' && f.node === 'check').at(-1)
    expect(check).toMatchObject({ detail: expect.stringContaining('Kept the first-pass summary: it covers 2 of 3 chunks, the retry pass 1 of 3.') })
    expect(edgeLabels(frames).at(-1)).toBe('1 chunk still missing after the retry')
  })

  it('keeps the first summary on a tie', async () => {
    const { result } = await run(THREE, { ...first, citeSecond: [2, 3] })

    expect(result?.summary.overview).toBe('First pass summary.')
    expect(result?.coverage.covered).toEqual([1, 3])
    expect(result?.notice).toContain('2 of 3 chunks against 2 of 3')
  })

  it('takes the second summary when it is better, even if it dropped a chunk the first one cited', async () => {
    const { result } = await run(FIVE, { failExtract: { 2: 1, 4: 1 }, citeSecond: [2, 3, 4, 5] })

    // First pass cites 1, 3, 5 (3 of 5). The second cites 2, 3, 4, 5 (4 of 5), losing chunk 1.
    expect(result?.summary.overview).toBe('Second pass summary.')
    expect(result?.coverage.covered).toEqual([2, 3, 4, 5])
    expect(result?.notice).toBeNull()
  })
})

describe('the result says what happened to the retry', () => {
  it('none: no chunk needed a retry', async () => {
    const { result } = await run(THREE, {})
    expect(result).toMatchObject({ retryOutcome: 'none', retries: 0, notice: null })
  })

  it('used: the retry ran and its summary is the one returned', async () => {
    const { result } = await run(THREE, { failExtract: { 2: 1 } })
    expect(result).toMatchObject({ retryOutcome: 'used', retries: 1 })
  })

  it('kept-first: the retry ran but the first-pass summary is returned, with the first pass flags only', async () => {
    const { result, frames } = await run(THREE, { failExtract: { 2: 1 }, citeSecond: [2, 3], flags: [1] })

    expect(result).toMatchObject({ retryOutcome: 'kept-first', retries: 1, reviewFlags: [1] })
    const check = frames.filter((f) => f.type === 'node_end' && f.node === 'check').at(-1)
    expect(check).toMatchObject({
      detail: "Kept the first-pass summary: it covers 2 of 3 chunks, the retry pass 2 of 3. The retry pass's review flags were discarded with it.",
    })
    expect((check as { detail: string }).detail).not.toContain('Review flagged')
  })

  it('skipped: the retry was left out for lack of time', async () => {
    const budget = new RunBudget(60_000)
    vi.spyOn(budget, 'remaining').mockImplementation(() => 5_000)
    const { result } = await run(THREE, { failExtract: { 2: 1 } }, budget)
    expect(result).toMatchObject({ retryOutcome: 'skipped', retries: 0 })
  })

  it('skipped: the retry did not finish, so the first-pass summary is returned', async () => {
    const { result } = await run(THREE, { failExtract: { 2: 1 }, failSecondSynthesis: true })
    expect(result?.retryOutcome).toBe('skipped')
  })
})

describe('a cut-off retry ends its steps honestly', () => {
  it('sends a failed row for the cut-off step, then a final row, before the result', async () => {
    const { frames, result } = await run(THREE, { failExtract: { 2: 1 }, failSecondSynthesis: true })

    const types = frames.map((f) => (f.type === 'node_end' ? `end ${f.node} ${f.status}` : f.type === 'node_start' ? `start ${f.node}` : f.type))
    const tail = types.slice(types.lastIndexOf('start synthesize'))
    expect(tail).toEqual(['start synthesize', 'end synthesize failed', 'start final', 'end final ok', 'result'])
    expect(frames).toContainEqual(
      expect.objectContaining({ type: 'node_end', node: 'synthesize', status: 'failed', detail: CUT_OFF_MESSAGE, message: CUT_OFF_MESSAGE }),
    )
    expect(frames).toContainEqual(expect.objectContaining({ type: 'node_end', node: 'final', status: 'ok', detail: KEPT_FIRST_PASS }))
    expect(result?.summary.overview).toBe('First pass summary.')
  })
})
