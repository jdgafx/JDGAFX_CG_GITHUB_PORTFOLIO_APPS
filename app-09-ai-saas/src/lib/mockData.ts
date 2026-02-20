export interface DailyUsage {
  date: string
  api_calls: number
  tokens: number
  cost: number
  response_time: number
}

export interface FeatureUsage {
  feature: string
  calls: number
}

export interface HourlyActivity {
  hour: string
  requests: number
}

export interface SummaryStats {
  totalApiCalls: number
  totalTokens: number
  avgResponseTime: number
  totalCost: number
  apiCallsTrend: number
  tokensTrend: number
  responseTimeTrend: number
  costTrend: number
}

function seedRand(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

function generateDailyUsage(): DailyUsage[] {
  const rand = seedRand(42)
  const result: DailyUsage[] = []
  const today = new Date(2026, 1, 20)

  for (let i = 29; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(today.getDate() - i)
    const dateStr = date.toISOString().split('T')[0]

    const base = 1000 + i * 30
    const api_calls = Math.round(base + rand() * 500 - 250)
    const tokens = Math.round(api_calls * (1500 + rand() * 500))
    const cost = Math.round(tokens * 0.0000015 * 100) / 100
    const response_time = Math.round(180 + rand() * 120)

    result.push({ date: dateStr, api_calls, tokens, cost, response_time })
  }
  return result
}

export const mockDailyUsage: DailyUsage[] = generateDailyUsage()

export const mockFeatureUsage: FeatureUsage[] = [
  { feature: 'Chat', calls: 4821 },
  { feature: 'Summarize', calls: 3240 },
  { feature: 'Classify', calls: 2890 },
  { feature: 'Extract', calls: 2150 },
  { feature: 'Translate', calls: 1870 },
  { feature: 'Embed', calls: 1560 },
  { feature: 'Generate', calls: 1230 },
  { feature: 'Analyze', calls: 980 },
]

export const mockHourlyActivity: HourlyActivity[] = Array.from({ length: 24 }, (_, i) => ({
  hour: `${String(i).padStart(2, '0')}:00`,
  requests: Math.round(20 + Math.sin((i - 9) * 0.4) * 80 + Math.random() * 30),
}))

function computeSummary(): SummaryStats {
  const recent = mockDailyUsage.slice(15)
  const prev = mockDailyUsage.slice(0, 15)

  const recentCalls = recent.reduce((s, d) => s + d.api_calls, 0)
  const prevCalls = prev.reduce((s, d) => s + d.api_calls, 0)
  const recentTokens = recent.reduce((s, d) => s + d.tokens, 0)
  const prevTokens = prev.reduce((s, d) => s + d.tokens, 0)
  const recentRT = recent.reduce((s, d) => s + d.response_time, 0) / recent.length
  const prevRT = prev.reduce((s, d) => s + d.response_time, 0) / prev.length
  const recentCost = recent.reduce((s, d) => s + d.cost, 0)
  const prevCost = prev.reduce((s, d) => s + d.cost, 0)

  const trend = (curr: number, prev: number) =>
    Math.round(((curr - prev) / prev) * 100 * 10) / 10

  return {
    totalApiCalls: recentCalls,
    totalTokens: recentTokens,
    avgResponseTime: Math.round(recentRT),
    totalCost: Math.round(recentCost * 100) / 100,
    apiCallsTrend: trend(recentCalls, prevCalls),
    tokensTrend: trend(recentTokens, prevTokens),
    responseTimeTrend: trend(recentRT, prevRT),
    costTrend: trend(recentCost, prevCost),
  }
}

export const mockSummaryStats: SummaryStats = computeSummary()
