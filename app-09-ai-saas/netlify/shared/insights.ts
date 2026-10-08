/** Summary figures the dashboard sends. Every field is a finite number once sanitised. */
export interface Metrics {
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

/** Days on each side of the metric comparison. */
export const COMPARISON_DAYS = 15

/** Figures the prompt carries: five values and five trends. */
export const METRIC_COUNT = 10

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}%`
}

export function buildPrompt(m: Metrics): string {
  const vs = `vs prev ${COMPARISON_DAYS} days`
  return `You are an expert SaaS analytics consultant. Analyze these API usage metrics from the last ${COMPARISON_DAYS} days and provide 4-5 concise, actionable insights:

Metrics:
- Total API Calls: ${m.totalApiCalls.toLocaleString()} (${signed(m.apiCallsTrend)} ${vs})
- Total Tokens: ${m.totalTokens.toLocaleString()} (${signed(m.tokensTrend)} ${vs})
- Average Response Time: ${m.avgResponseTime}ms (${signed(m.responseTimeTrend)} ${vs})
- Error Rate: ${m.avgErrorRate}% of requests (${signed(m.errorRateTrend)} ${vs})
- Total Cost: $${m.totalCost} (${signed(m.costTrend)} ${vs})

Note that lower response time, error rate and cost are improvements. Provide specific, data-driven insights, using only the figures listed above. Do not invent percentages, rankings, or per-endpoint or per-customer numbers. Be direct and actionable. Format as numbered insights with brief explanations.

Output plain text only. Do not use markdown headings, asterisks, or any other markup.`
}

type Unit = '%' | 'ms' | '$'

/**
 * A figure the check can match: a dollar amount, or a number followed by % or ms. Plain counts
 * and the day window are not figures to check.
 */
const FIGURE = /\$\s?(\d[\d,]*(?:\.\d+)?)(?![A-Za-z])|(\d[\d,]*(?:\.\d+)?)\s?(%|ms)(?![A-Za-z])/g

export interface FigureCheck {
  checked: number
  matched: number
  unmatched: string[]
}

function snapshotFigures(m: Metrics): Record<Unit, number[]> {
  return {
    '%': [m.avgErrorRate, m.apiCallsTrend, m.tokensTrend, m.responseTimeTrend, m.costTrend, m.errorRateTrend].map(Math.abs),
    ms: [m.avgResponseTime],
    $: [m.totalCost],
  }
}

/**
 * Matches each checkable figure in the answer against the snapshot. A figure matches when it
 * equals a snapshot value at its own rounding, or within 0.5%. This shows which numbers come
 * from the data. It does not judge the conclusion drawn from them.
 */
export function checkFigures(text: string, m: Metrics): FigureCheck {
  const pool = snapshotFigures(m)
  const result: FigureCheck = { checked: 0, matched: 0, unmatched: [] }
  for (const [whole, dollar, plain, unit] of text.matchAll(FIGURE)) {
    const digits = dollar ?? plain
    const value = Number(digits.replace(/,/g, ''))
    const decimals = digits.split('.')[1]?.length ?? 0
    const key: Unit = dollar !== undefined ? '$' : (unit as Unit)
    const matches = pool[key].some((v) => Math.abs(value - v) <= Math.max(0.5 * 10 ** -decimals, 0.005 * v))
    result.checked += 1
    if (matches) result.matched += 1
    else result.unmatched.push(whole.trim())
  }
  return result
}
