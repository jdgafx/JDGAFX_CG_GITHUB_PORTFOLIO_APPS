import { describe, expect, it } from 'vitest'
import { shortModel } from '../../src/lib/format'
import { formatCount, formatMs, formatUsd, sumUsage } from '../../src/lib/usage'

describe('shortModel', () => {
  it('drops the provider prefix, including the ~ of an OpenRouter alias', () => {
    expect(shortModel('anthropic/claude-haiku-5.5')).toBe('claude-haiku-5.5')
    expect(shortModel('~anthropic/claude-haiku-latest')).toBe('claude-haiku-latest')
    expect(shortModel('plain')).toBe('plain')
  })
})

describe('sumUsage', () => {
  it('adds every field across stages', () => {
    const total = sumUsage([
      { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160, cost: 0.0001 },
      { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230, cost: 0.00008 },
    ])
    expect(total.prompt_tokens).toBe(320)
    expect(total.completion_tokens).toBe(70)
    expect(total.total_tokens).toBe(390)
    expect(total.cost).toBeCloseTo(0.00018, 10)
  })

  it('reports a field only when every stage reported it', () => {
    const total = sumUsage([
      { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0002 },
      { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 },
    ])
    expect(total).toEqual({ prompt_tokens: 30, completion_tokens: 11, total_tokens: 41 })
    expect(total.cost).toBeUndefined()
  })

  it('reports nothing for an empty run or when no stage has usage', () => {
    expect(sumUsage([])).toEqual({})
    expect(sumUsage([undefined, {}])).toEqual({})
  })
})

describe('usage formatters', () => {
  it('shows counts with thousands separators and a gap as not reported', () => {
    expect(formatCount(1234)).toBe('1,234')
    expect(formatCount(undefined)).toBe('not reported')
  })

  it('shows milliseconds with a unit', () => {
    expect(formatMs(9400)).toBe('9,400 ms')
    expect(formatMs(undefined)).toBe('not reported')
  })

  it('shows USD to six decimal places', () => {
    expect(formatUsd(0.0002)).toBe('$0.000200')
    expect(formatUsd(0.00063)).toBe('$0.000630')
    expect(formatUsd(undefined)).toBe('not reported')
  })
})
