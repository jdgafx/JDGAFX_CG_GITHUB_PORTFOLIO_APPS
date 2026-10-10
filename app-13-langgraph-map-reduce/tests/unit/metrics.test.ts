import { describe, expect, it } from 'vitest'
import { metricsFor } from '../../src/lib/metrics'
import type { TraceRow } from '../../src/types/frames'

const SERVED = 'anthropic/claude-haiku-5.5'
const RATE = { prompt: 0.0000001, completion: 0.0000005 }

const priced = (over: Partial<TraceRow>): TraceRow => ({
  node: 'extract',
  status: 'ok',
  ms: 10,
  detail: 'chunk 1 of 3',
  chunk: 1,
  model: '~anthropic/claude-haiku-latest',
  servedModel: SERVED,
  usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
  priceState: 'priced',
  cost: 0.1,
  rate: RATE,
  ...over,
})

const rows: TraceRow[] = [
  priced({ chunk: 1, usage: { total_tokens: 1200 }, cost: 0.1 }),
  {
    node: 'extract',
    status: 'failed',
    ms: 10,
    detail: 'chunk 2 of 3',
    chunk: 2,
    model: '~anthropic/claude-haiku-latest',
    message: 'The AI provider did not answer in time.',
  },
  priced({ chunk: 3, detail: 'chunk 3 of 3', usage: { total_tokens: 800 }, cost: 0.2 }),
  priced({ node: 'check', detail: 'Review flagged 0 chunks as thin in the summary', chunk: undefined, usage: { total_tokens: 300 }, cost: 0.01 }),
  priced({ node: 'synthesize', detail: '2 sections, 4 points', chunk: undefined, usage: { total_tokens: 700 }, cost: 0.5 }),
]

describe('metricsFor', () => {
  it('counts the cheap calls that answered, the same ones the cheap cost adds up, and not the one that timed out', () => {
    expect(metricsFor(rows, 99).cheapCalls).toBe(3)
  })

  it('pairs the cost of every answered extract call with a count of the same calls, failed ones included', () => {
    const nine: TraceRow[] = Array.from({ length: 9 }, (_, i) =>
      priced({ status: i < 1 ? 'ok' : 'failed', chunk: i + 1, cost: 0.000069 }),
    )

    const metrics = metricsFor(nine, 1)

    expect(metrics.cheapCalls).toBe(9)
    expect(metrics.cheapCost).toBeCloseTo(0.000621, 9)
  })

  it('sums tokens and cost and keeps the cheap and synthesis costs apart', () => {
    const metrics = metricsFor(rows, 99)

    expect(metrics.totalMs).toBe(99)
    expect(metrics.totalTokens).toBe(3000)
    expect(metrics.totalCost).toBeCloseTo(0.81, 9)
    expect(metrics.priceNote).toBeNull()
    expect(metrics.cheapCost).toBeCloseTo(0.31, 9)
    expect(metrics.synthesisCost).toBeCloseTo(0.5, 9)
  })

  it('reports no cost when no call answered', () => {
    expect(metricsFor([rows[1]], 1)).toMatchObject({ totalCost: null, priceNote: null, cheapCost: null, cheapCalls: 0, synthesisCost: null })
  })

  it('keeps the tokens but gives no total when the reply named no model, and says so', () => {
    const noModel = rows.map((r) => (r.priceState ? { ...r, servedModel: null, priceState: 'no-served-model' as const, cost: undefined, rate: undefined } : r))

    expect(metricsFor(noModel, 1)).toMatchObject({
      totalTokens: 3000,
      totalCost: null,
      cheapCost: null,
      synthesisCost: null,
      priceNote: 'no-served-model',
      cheapCalls: 3,
    })
  })

  it('keeps the tokens but gives no total when the price list was unavailable, and says so', () => {
    const none = rows.map((r) => (r.priceState ? { ...r, priceState: 'unavailable' as const, cost: undefined, rate: undefined } : r))

    expect(metricsFor(none, 1)).toMatchObject({ totalTokens: 3000, totalCost: null, priceNote: 'unavailable' })
  })

  it('gives no total when only some calls were priced, since a partial sum would read as the whole', () => {
    const mixed = [rows[0], { ...rows[2], priceState: 'unavailable' as const, cost: undefined, rate: undefined }]

    const metrics = metricsFor(mixed, 1)

    expect(metrics.totalCost).toBeNull()
    expect(metrics.priceNote).toBe('unavailable')
  })

  it('names an unavailable list before a missing model when both occur', () => {
    const both = [
      { ...rows[0], priceState: 'no-served-model' as const, cost: undefined, rate: undefined },
      { ...rows[2], priceState: 'unavailable' as const, cost: undefined, rate: undefined },
    ]

    expect(metricsFor(both, 1).priceNote).toBe('unavailable')
  })
})
