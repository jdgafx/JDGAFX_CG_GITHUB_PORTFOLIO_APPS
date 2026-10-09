import { describe, expect, it } from 'vitest'
import { metricsFor } from '../../src/lib/metrics'
import type { TraceRow } from '../../src/types/frames'

const EXTRACT_MODEL = 'meta-llama/llama-3.1-8b-instruct'

const rows: TraceRow[] = [
  {
    node: 'extract',
    status: 'ok',
    ms: 10,
    detail: 'chunk 1 of 3',
    chunk: 1,
    model: EXTRACT_MODEL,
    usage: { total_tokens: 1200 },
    cost: 0.1,
    costSource: 'usage',
  },
  {
    node: 'extract',
    status: 'failed',
    ms: 10,
    detail: 'chunk 2 of 3',
    chunk: 2,
    model: EXTRACT_MODEL,
    message: 'The AI provider did not answer in time.',
  },
  {
    node: 'extract',
    status: 'ok',
    ms: 10,
    detail: 'chunk 3 of 3',
    chunk: 3,
    model: EXTRACT_MODEL,
    usage: { total_tokens: 800 },
    cost: 0.2,
    costSource: 'estimated',
  },
  {
    node: 'check',
    status: 'ok',
    ms: 5,
    detail: 'Review flagged 0 chunks as omitted',
    model: 'xiaomi/mimo-v2.6-flash',
    usage: { total_tokens: 300 },
    cost: 0.01,
    costSource: 'usage',
  },
  {
    node: 'synthesize',
    status: 'ok',
    ms: 20,
    detail: '2 sections, 4 points',
    model: '~anthropic/claude-haiku-latest',
    usage: { total_tokens: 700 },
    cost: 0.5,
    costSource: 'usage',
  },
]

describe('metricsFor', () => {
  it('counts the cheap calls that were costed, the same ones the cheap cost adds up', () => {
    expect(metricsFor(rows, 99).cheapCalls).toBe(3)
  })

  it('pairs the cost of every costed extract call with a count of the same calls, failed ones included', () => {
    const nine: TraceRow[] = Array.from({ length: 9 }, (_, i) => ({
      ...rows[0],
      status: i < 1 ? ('ok' as const) : ('failed' as const),
      chunk: i + 1,
      cost: 0.000069,
      costSource: 'usage' as const,
    }))

    const metrics = metricsFor(nine, 1)

    expect(metrics.cheapCalls).toBe(9)
    expect(metrics.cheapCost).toBeCloseTo(0.000621, 9)
  })

  it('sums tokens and cost, labels an estimate, and keeps the cheap and synthesis costs apart', () => {
    const metrics = metricsFor(rows, 99)

    expect(metrics.totalMs).toBe(99)
    expect(metrics.totalTokens).toBe(3000)
    expect(metrics.totalCost).toBeCloseTo(0.81, 9)
    expect(metrics.costSource).toBe('estimated')
    expect(metrics.cheapCost).toBeCloseTo(0.31, 9)
    expect(metrics.synthesisCost).toBeCloseTo(0.5, 9)
  })

  it('counts a failed call that reported a cost, because its cost is in the total', () => {
    const billed: TraceRow = { ...rows[1], cost: 0.05, costSource: 'usage' }

    const metrics = metricsFor([billed], 1)

    expect(metrics.cheapCalls).toBe(1)
    expect(metrics.cheapCost).toBeCloseTo(0.05, 9)
  })

  it('reports no cost when no row has one', () => {
    expect(metricsFor([rows[1]], 1)).toMatchObject({
      totalCost: null,
      costSource: null,
      cheapCost: null,
      cheapCalls: 0,
    })
  })
})
