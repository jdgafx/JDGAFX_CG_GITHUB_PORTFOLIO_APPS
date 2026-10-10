import { describe, expect, it } from 'vitest'
import { barPercent, formatCost, formatCount, formatDelta, formatMs, formatPrice, formatRating, formatUsd, plainModel, splitModel, tokensPerSecond } from '../../src/lib/format'

describe('formatUsd', () => {
  it('shows six decimals', () => {
    expect(formatUsd(0.0002)).toBe('$0.000200')
    expect(formatUsd(0)).toBe('$0.000000')
  })

  it('shows a tiny positive cost as a bound, not as zero', () => {
    expect(formatUsd(0.0000004)).toBe('< $0.000001')
  })
})

describe('formatCost', () => {
  it('says not reported when there is no cost', () => {
    expect(formatCost(null)).toBe('not reported')
  })

  it('names where the cost came from', () => {
    expect(formatCost({ usd: 0.0002, source: 'estimated' })).toBe('$0.000200 (estimated)')
    expect(formatCost({ usd: 0.0002, source: 'usage' })).toBe('$0.000200 (usage)')
  })
})

describe('formatMs and formatCount', () => {
  it('rounds milliseconds and groups thousands', () => {
    expect(formatMs(1234.6)).toBe('1,235 ms')
    expect(formatMs(null)).toBe('not reported')
  })

  it('groups thousands in counts', () => {
    expect(formatCount(12345)).toBe('12,345')
    expect(formatCount(null)).toBe('not reported')
  })
})

describe('tokensPerSecond', () => {
  it('divides output tokens by the latency in seconds', () => {
    expect(tokensPerSecond(200, 4000)).toBe('50.0')
  })

  it('says not reported when a number is missing or the latency is zero', () => {
    expect(tokensPerSecond(null, 4000)).toBe('not reported')
    expect(tokensPerSecond(200, null)).toBe('not reported')
    expect(tokensPerSecond(200, 0)).toBe('not reported')
  })
})

describe('formatPrice', () => {
  it('shows prices per million tokens', () => {
    expect(formatPrice(0.1, 0.5)).toBe('$0.10 in / $0.50 out per 1M')
    expect(formatPrice(0, 0.0005)).toBe('$0 in / $0.00050 out per 1M')
  })

  it('says when a price is not listed', () => {
    expect(formatPrice(null, null)).toBe('price not listed')
    expect(formatPrice(null, 2)).toBe('not listed in / $2.00 out per 1M')
  })
})

describe('barPercent', () => {
  it('scales a value against the run maximum and caps at 100', () => {
    expect(barPercent(50, 200)).toBe(25)
    expect(barPercent(300, 200)).toBe(100)
  })

  it('draws no bar without a positive scale', () => {
    expect(barPercent(5, null)).toBe(0)
    expect(barPercent(5, 0)).toBe(0)
  })
})

describe('model and rating formatting', () => {
  it('splits a model id into vendor and name', () => {
    expect(splitModel('anthropic/claude-haiku-5.5')).toEqual({ vendor: 'anthropic', name: 'claude-haiku-5.5' })
    expect(splitModel('qwen/qwen3-coder:free/x')).toEqual({ vendor: 'qwen', name: 'qwen3-coder:free/x' })
    expect(splitModel('plain')).toEqual({ vendor: '', name: 'plain' })
    expect(splitModel('~anthropic/claude-haiku-latest')).toEqual({ vendor: 'anthropic', name: 'claude-haiku-latest' })
    expect(plainModel('~anthropic/claude-haiku-latest')).toBe('anthropic/claude-haiku-latest')
    expect(plainModel('anthropic/claude-haiku-5.5')).toBe('anthropic/claude-haiku-5.5')
  })

  it('rounds a rating to a whole number and a change to one decimal with its sign', () => {
    expect(formatRating(1005.766)).toBe('1,006')
    expect(formatRating(988)).toBe('988')
    expect(formatDelta(24)).toBe('+24.0')
    expect(formatDelta(-12)).toBe('−12.0')
    expect(formatDelta(5.766075)).toBe('+5.8')
    expect(formatDelta(0.0001)).toBe('±0.0')
  })
})
