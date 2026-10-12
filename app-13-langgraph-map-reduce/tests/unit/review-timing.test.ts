import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunBudget } from '../../netlify/shared/budget'
import { ProviderError } from '../../netlify/shared/errors'
import { CHECK_BUDGET_MARGIN_MS, MODEL } from '../../netlify/shared/models'
import type { ChatFn, ChatReply } from '../../netlify/shared/openrouter'
import { RUN_BUDGET_MS } from '../../netlify/shared/pipeline'
import { roleOf } from '../helpers/roles'
import { runSplit } from '../helpers/split'

const paragraph = (n: number): string => Array.from({ length: 120 }, (_, i) => `term${n}w${i}`).join(' ') + '.'
const THREE = [1, 2, 3].map(paragraph).join('\n')
const reply = (text: string): ChatReply => ({ text, finishReason: 'stop', servedModel: MODEL, usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } })

/** The slowest synthesis SP2 and the proof runs saw (3,711 tokens, 14.0 s), a slow review and a slow attribution call, in virtual milliseconds. */
const LATENCY = { synthesize: 14_500, check: 6_000, attribute: 4_500, extract: 0 }

/** A provider with those latencies that, like the real one, ends a call at its own time limit. */
function slowProvider(timeline: Array<{ role: string; start: number; end: number; outcome: string }>, t0: number): ChatFn {
  return async (request) => {
    const role = roleOf(request)
    const start = Date.now() - t0
    const wait = Math.min(LATENCY[role], request.timeoutMs ?? Infinity)
    await new Promise((resolve) => setTimeout(resolve, wait))
    const timedOut = LATENCY[role] > (request.timeoutMs ?? Infinity)
    timeline.push({ role, start, end: Date.now() - t0, outcome: timedOut ? 'timeout' : 'ok' })
    if (timedOut) throw new ProviderError('timeout')
    const user = request.messages[request.messages.length - 1]?.content ?? ''
    if (role === 'extract') {
      const chunk = /^Chunk (\d+) of/.exec(user)?.[1]
      return reply(JSON.stringify({ points: [`Rule ${chunk}.`, `Detail ${chunk}.`], entities: [] }))
    }
    if (role === 'synthesize') {
      return reply(JSON.stringify({ overview: 'Three rules.', sections: [{ heading: 'Rules', points: [1, 2, 3].map((n) => ({ text: `Rule ${n} holds.`, chunks: [n] })) }] }))
    }
    if (role === 'attribute') {
      const chunk = /Key points of chunk (\d+):/.exec(user)?.[1]
      return reply(JSON.stringify({ states: [{ sentence: Number(chunk), points: [`${chunk}.1`] }] }))
    }
    return reply(JSON.stringify({ important: ['1.2', '2.2'] }))
  }
}

describe('the review fits the synthesize request after the slowest synthesis seen (proof run g2)', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  it('finishes the review inside the 23 s budget and adds its central points, with synthesis 14.5 s, attribution 4.5 s and review 6 s', async () => {
    const t0 = Date.now()
    const timeline: Array<{ role: string; start: number; end: number; outcome: string }> = []
    const pending = runSplit(THREE, slowProvider(timeline, t0), { budgetSecond: new RunBudget(RUN_BUDGET_MS) })
    await vi.advanceTimersByTimeAsync(40_000)
    const run = await pending

    expect(run.errors).toEqual([])
    expect(run.results[0]).toMatchObject({ review: 'done', reviewFlags: ['1.2', '2.2'] })
    const review = timeline.find((c) => c.role === 'check')!
    const synthesis = timeline.find((c) => c.role === 'synthesize')!
    const attribution = timeline.filter((c) => c.role === 'attribute')
    // The review starts when synthesis ends, together with the attribution calls, not after the slowest of them.
    expect(review.start).toBe(synthesis.end)
    expect(review.outcome).toBe('ok')
    expect(review.end).toBeLessThanOrEqual(RUN_BUDGET_MS - CHECK_BUDGET_MARGIN_MS)
    expect(Math.max(...attribution.map((c) => c.end))).toBeLessThanOrEqual(RUN_BUDGET_MS - CHECK_BUDGET_MARGIN_MS)
    expect(run.results[0]?.coverage.citedPoints).toEqual(['1.1', '1.2', '2.1', '2.2', '3.1'])
  })
})
