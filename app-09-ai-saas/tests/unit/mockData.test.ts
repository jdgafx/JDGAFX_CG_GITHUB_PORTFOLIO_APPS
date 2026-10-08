import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function loadMockData() {
  vi.resetModules()
  return import('../../src/lib/mockData')
}

beforeEach(() => {
  // Pin the clock so the date column is the same on every run.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 8, 12))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('seeded demo dataset', () => {
  it('covers 30 days ending on the pinned date, with 15-day comparison windows', async () => {
    const { mockDailyUsage, WINDOW_DAYS, COMPARISON_DAYS } = await loadMockData()
    expect(WINDOW_DAYS).toBe(30)
    expect(COMPARISON_DAYS).toBe(15)
    expect(mockDailyUsage).toHaveLength(30)
    expect(mockDailyUsage[0].date).toBe('2026-09-09')
    expect(mockDailyUsage[29].date).toBe('2026-10-08')
    expect(new Set(mockDailyUsage.map((d) => d.date)).size).toBe(30)
  })

  it('produces the same numbers on every load', async () => {
    const first = await loadMockData()
    const second = await loadMockData()
    expect(second.mockDailyUsage).toEqual(first.mockDailyUsage)
    expect(second.mockSummaryStats).toEqual(first.mockSummaryStats)
  })

  it('has the expected values for the first, second and last days', async () => {
    const { mockDailyUsage } = await loadMockData()
    expect(mockDailyUsage[0]).toEqual({
      date: '2026-09-09',
      api_calls: 876,
      tokens: 1352599,
      cost: 2.43,
      response_time: 312,
      error_rate: 2.53,
    })
    expect(mockDailyUsage[1]).toEqual({
      date: '2026-09-10',
      api_calls: 968,
      tokens: 1464421,
      cost: 2.61,
      response_time: 298,
      error_rate: 2.42,
    })
    expect(mockDailyUsage[29]).toEqual({
      date: '2026-10-08',
      api_calls: 1896,
      tokens: 3416173,
      cost: 4.17,
      response_time: 223,
      error_rate: 1.18,
    })
  })

  it('keeps every day inside the ranges the generator sets', async () => {
    const { mockDailyUsage } = await loadMockData()
    mockDailyUsage.forEach((d, day) => {
      expect(d.api_calls).toBeGreaterThanOrEqual(750 + 30 * day)
      expect(d.api_calls).toBeLessThanOrEqual(1250 + 30 * day)
      // Tokens per call are drawn from 1500 to 2000; one unit of slack covers rounding.
      const tokensPerCall = d.tokens / d.api_calls
      expect(tokensPerCall).toBeGreaterThanOrEqual(1499)
      expect(tokensPerCall).toBeLessThanOrEqual(2001)
      expect(d.response_time).toBeGreaterThanOrEqual(260 - 2 * day)
      expect(d.response_time).toBeLessThanOrEqual(350 - 2 * day)
      expect(d.error_rate).toBeGreaterThanOrEqual(0.1)
      expect(d.error_rate).toBeLessThanOrEqual(3)
      expect(d.cost).toBeGreaterThan(0)
    })
  })

  it('computes the summary from the last 15 days against the 15 before', async () => {
    const { mockDailyUsage, mockSummaryStats } = await loadMockData()
    const recentCalls = mockDailyUsage.slice(15).reduce((total, d) => total + d.api_calls, 0)
    expect(mockSummaryStats.totalApiCalls).toBe(recentCalls)
    expect(mockSummaryStats).toEqual({
      totalApiCalls: 24656,
      totalTokens: 42371783,
      avgResponseTime: 253,
      totalCost: 57.35,
      avgErrorRate: 1.67,
      apiCallsTrend: 30.9,
      tokensTrend: 29.6,
      responseTimeTrend: -13.5,
      costTrend: 6.3,
      errorRateTrend: -28.3,
    })
  })

  it('shows traffic growing while latency and errors improve', async () => {
    const { mockSummaryStats } = await loadMockData()
    expect(mockSummaryStats.apiCallsTrend).toBeGreaterThan(0)
    expect(mockSummaryStats.responseTimeTrend).toBeLessThan(0)
    expect(mockSummaryStats.errorRateTrend).toBeLessThan(0)
  })

  it('lists eight features with Chat as the largest', async () => {
    const { mockFeatureUsage } = await loadMockData()
    expect(mockFeatureUsage).toHaveLength(8)
    const top = mockFeatureUsage.reduce((best, f) => (f.calls > best.calls ? f : best))
    expect(top).toEqual({ feature: 'Chat', calls: 4821 })
  })
})
