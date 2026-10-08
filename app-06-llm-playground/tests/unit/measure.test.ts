import { describe, expect, it } from 'vitest'
import type { LiveModel } from '../../netlify/shared/catalogue'
import type { PanelResult, Usage } from '../../netlify/shared/contract'
import { costOf, summarise, usageFrom } from '../../netlify/shared/measure'

function usage(prompt: number | null, completion: number | null): Usage {
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    reasoning_tokens: null,
    total_tokens: prompt !== null && completion !== null ? prompt + completion : null,
  }
}

function live(id: string, promptPerTok: number | null, completionPerTok: number | null): [string, LiveModel] {
  return [id, { id, name: id, contextLength: 128_000, promptPerTok, completionPerTok, textOutput: true }]
}

const prices = new Map<string, LiveModel>([
  live('vendor/cheap', 1e-7, 5e-7),
  live('vendor/free', 0, 0),
  live('vendor/unpriced', null, null),
])

function answered(slot: 'A' | 'B' | 'C', over: Partial<PanelResult> = {}): PanelResult {
  return {
    slot,
    requestedModel: `req/${slot}`,
    servedModel: `served/${slot}`,
    ok: true,
    error: null,
    text: 'READY',
    finishReason: 'stop',
    latencyMs: 800,
    usage: usage(10, 3),
    cost: null,
    ...over,
  }
}

describe('costOf', () => {
  it('uses the billed cost when the provider reports one', () => {
    expect(costOf(usage(1000, 200), 0.00042, 'vendor/cheap', prices)).toEqual({ usd: 0.00042, source: 'usage' })
  })

  it('keeps a reported zero, because the provider said it', () => {
    expect(costOf(usage(1000, 200), 0, 'vendor/free', prices)).toEqual({ usd: 0, source: 'usage' })
  })

  it('estimates from the served model price when the provider reports no cost', () => {
    // 1000 prompt tokens at 1e-7 plus 200 completion tokens at 5e-7 is 0.0002.
    const cost = costOf(usage(1000, 200), undefined, 'vendor/cheap', prices)
    expect(cost?.source).toBe('estimated')
    expect(cost?.usd).toBeCloseTo(0.0002, 12)
  })

  it('reports no cost rather than an estimate of zero', () => {
    expect(costOf(usage(1000, 200), undefined, 'vendor/free', prices)).toBeNull()
  })

  it('reports no cost when the price, the token counts or the model is unknown', () => {
    expect(costOf(usage(1000, 200), undefined, 'vendor/unpriced', prices)).toBeNull()
    expect(costOf(usage(1000, 200), undefined, 'vendor/missing', prices)).toBeNull()
    expect(costOf(usage(null, 200), undefined, 'vendor/cheap', prices)).toBeNull()
    expect(costOf(usage(1000, 200), undefined, 'vendor/cheap', null)).toBeNull()
  })

  it('ignores a reported cost that is not a number', () => {
    expect(costOf(usage(1000, 200), 'n/a', 'vendor/cheap', prices)?.source).toBe('estimated')
  })
})

describe('usageFrom', () => {
  it('reads the token counts, the reasoning split and the billed cost from a chat reply', () => {
    const data = {
      model: 'vendor/cheap',
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 200,
        total_tokens: 1200,
        cost: 0.0003,
        completion_tokens_details: { reasoning_tokens: 150 },
      },
    }
    const result = usageFrom(data, 'vendor/cheap', prices)
    expect(result.usage).toEqual({ prompt_tokens: 1000, completion_tokens: 200, reasoning_tokens: 150, total_tokens: 1200 })
    expect(result.cost).toEqual({ usd: 0.0003, source: 'usage' })
  })

  it('returns empty usage and no cost when the reply has no usage block', () => {
    const result = usageFrom({ choices: [] }, null, null)
    expect(result.usage).toEqual({ prompt_tokens: null, completion_tokens: null, reasoning_tokens: null, total_tokens: null })
    expect(result.cost).toBeNull()
  })
})

describe('summarise', () => {
  it('names the fastest, cheapest and longest answers from measured values', () => {
    const summary = summarise([
      answered('A', { latencyMs: 900, usage: usage(10, 3), cost: { usd: 0.0004, source: 'usage' } }),
      answered('B', { latencyMs: 450, usage: usage(10, 8), cost: { usd: 0.0002, source: 'estimated' } }),
      answered('C', { latencyMs: 1200, usage: usage(10, 5), cost: null }),
    ])
    expect(summary.fastest).toEqual({ slot: 'B', model: 'served/B', latencyMs: 450 })
    expect(summary.cheapest).toEqual({ slot: 'B', model: 'served/B', usd: 0.0002, source: 'estimated' })
    expect(summary.mostOutputTokens).toEqual({ slot: 'B', model: 'served/B', tokens: 8 })
  })

  it('ignores failed panels', () => {
    const summary = summarise([
      answered('A', { ok: false, error: 'boom', latencyMs: 100, cost: { usd: 0.0001, source: 'usage' }, usage: usage(10, 50) }),
      answered('B', { latencyMs: 700, usage: usage(10, 4) }),
      answered('C', { ok: false, error: 'boom', latencyMs: null, usage: usage(null, null) }),
    ])
    expect(summary.fastest?.slot).toBe('B')
    expect(summary.cheapest).toBeNull()
    expect(summary.mostOutputTokens).toEqual({ slot: 'B', model: 'served/B', tokens: 4 })
  })

  it('breaks ties toward the earlier panel', () => {
    const summary = summarise([answered('A', { latencyMs: 500 }), answered('B', { latencyMs: 500 })])
    expect(summary.fastest?.slot).toBe('A')
  })

  it('reports nothing when no panel answered', () => {
    const summary = summarise([answered('A', { ok: false, error: 'boom', latencyMs: null, usage: usage(null, null) })])
    expect(summary).toMatchObject({ fastest: null, cheapest: null, mostOutputTokens: null })
  })

  it('names the requested model when the provider did not report the served one', () => {
    const summary = summarise([answered('C', { servedModel: null, latencyMs: 300 })])
    expect(summary.fastest).toEqual({ slot: 'C', model: 'req/C', latencyMs: 300 })
  })
})
