export interface DailyUsage {
  date: string
  api_calls: number
  tokens: number
  cost: number
  response_time: number
  error_rate: number
}

export interface FeatureUsage {
  feature: string
  calls: number
}

export interface SummaryStats {
  totalApiCalls: number
  totalTokens: number
  avgResponseTime: number
  totalCost: number
  avgErrorRate: number
  apiCallsTrend: number
  tokensTrend: number
  responseTimeTrend: number
  costTrend: number
  errorRateTrend: number
}

/** Days of history the charts cover. */
export const WINDOW_DAYS = 30

/** Metric cards compare the latest half of the window against the half before it. */
export const COMPARISON_DAYS = WINDOW_DAYS / 2

/** Fixed seed keeps the demo's shape identical across reloads and browsers. */
const SEED = 42

function seedRand(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Local-calendar YYYY-MM-DD — toISOString() would shift the day in most timezones. */
function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function generateDailyUsage(): DailyUsage[] {
  const rand = seedRand(SEED)
  const result: DailyUsage[] = []
  const today = new Date()

  for (let offset = WINDOW_DAYS - 1; offset >= 0; offset--) {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)

    // day 0 is the oldest point in the window, day 29 is today: traffic grows
    // while latency and errors improve, the shape of a healthy product.
    const day = WINDOW_DAYS - 1 - offset

    const api_calls = Math.round(1000 + day * 30 + rand() * 500 - 250)
    const tokens = Math.round(api_calls * (1500 + rand() * 500))
    // Blended cost per token falls as prompt caching adoption rises, so spend
    // grows slower than usage.
    const unitCost = 0.0000018 - day * 0.00000002
    const cost = round(tokens * unitCost, 2)
    const response_time = Math.round(260 - day * 2 + rand() * 90)
    const error_rate = round(Math.max(0.1, 2.4 - day * 0.05 + rand() * 0.6), 2)

    result.push({ date: isoDate(date), api_calls, tokens, cost, response_time, error_rate })
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

function computeSummary(): SummaryStats {
  const recent = mockDailyUsage.slice(COMPARISON_DAYS)
  const prev = mockDailyUsage.slice(0, COMPARISON_DAYS)

  const sum = (rows: DailyUsage[], pick: (d: DailyUsage) => number) =>
    rows.reduce((total, d) => total + pick(d), 0)
  const avg = (rows: DailyUsage[], pick: (d: DailyUsage) => number) =>
    sum(rows, pick) / rows.length

  const recentCalls = sum(recent, (d) => d.api_calls)
  const prevCalls = sum(prev, (d) => d.api_calls)
  const recentTokens = sum(recent, (d) => d.tokens)
  const prevTokens = sum(prev, (d) => d.tokens)
  const recentCost = sum(recent, (d) => d.cost)
  const prevCost = sum(prev, (d) => d.cost)
  const recentRT = avg(recent, (d) => d.response_time)
  const prevRT = avg(prev, (d) => d.response_time)
  const recentER = avg(recent, (d) => d.error_rate)
  const prevER = avg(prev, (d) => d.error_rate)

  const trend = (curr: number, before: number) => round(((curr - before) / before) * 100, 1)

  return {
    totalApiCalls: recentCalls,
    totalTokens: recentTokens,
    avgResponseTime: Math.round(recentRT),
    totalCost: round(recentCost, 2),
    avgErrorRate: round(recentER, 2),
    apiCallsTrend: trend(recentCalls, prevCalls),
    tokensTrend: trend(recentTokens, prevTokens),
    responseTimeTrend: trend(recentRT, prevRT),
    costTrend: trend(recentCost, prevCost),
    errorRateTrend: trend(recentER, prevER),
  }
}

export const mockSummaryStats: SummaryStats = computeSummary()
