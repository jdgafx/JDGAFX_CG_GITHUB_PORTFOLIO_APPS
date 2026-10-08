/** Summary figures the dashboard sends. Every field is a finite number once checked by parseInsightRequest. */
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

/** The prompt. It names only the snapshot figures and asks for plain text. */
export function buildPrompt(m: Metrics): string {
  const vs = `vs prev ${COMPARISON_DAYS} days`
  return `You are an expert SaaS analytics consultant. Analyze these API usage metrics from the last ${COMPARISON_DAYS} days and provide 4-5 concise, actionable insights:

Metrics:
- Total API Calls: ${m.totalApiCalls.toLocaleString('en-US')} (${signed(m.apiCallsTrend)} ${vs})
- Total Tokens: ${m.totalTokens.toLocaleString('en-US')} (${signed(m.tokensTrend)} ${vs})
- Average Response Time: ${m.avgResponseTime}ms (${signed(m.responseTimeTrend)} ${vs})
- Error Rate: ${m.avgErrorRate}% of requests (${signed(m.errorRateTrend)} ${vs})
- Total Cost: $${m.totalCost} (${signed(m.costTrend)} ${vs})

Note that lower response time, error rate and cost are improvements. Provide specific, data-driven insights, using only the figures listed above. Do not invent percentages, rankings, or per-endpoint or per-customer numbers. Be direct and actionable. Format as numbered insights with brief explanations.

Output plain text only. Do not use markdown headings, asterisks, or any other markup.`
}

type Unit = '%' | 'ms' | '$'

type Sign = 1 | -1 | 0

/**
 * A figure the check can match: a dollar amount, or a number followed by % or ms. Plain counts
 * and the day window are not figures to check.
 */
const FIGURE = /\$\s?(\d[\d,]*(?:\.\d+)?)(?![A-Za-z])|(\d[\d,]*(?:\.\d+)?)\s?(%|ms)(?![A-Za-z])/g

/** Words that say a trend rose, and words that say it fell. Only these set the direction of a figure. */
const RISE_WORDS = new Set(['up', 'rose', 'rise', 'rises', 'rising', 'grew', 'grow', 'grows', 'increased', 'increase', 'higher', 'climbed', 'jumped'])
const FALL_WORDS = new Set(['down', 'fell', 'fall', 'falls', 'dropped', 'drop', 'decreased', 'decrease', 'declined', 'decline', 'lower', 'reduced'])

/** How many words before a figure, in the same sentence, are read for its direction. */
const DIRECTION_WORDS = 4

interface FigureCheck {
  checked: number
  matched: number
  unmatched: string[]
}

interface SnapshotFigure {
  unit: Unit
  value: number
  /** A trend carries a sign. A level, such as an error rate, is never negative, so its sign is not checked. */
  trend: boolean
}

function snapshotFigures(m: Metrics): SnapshotFigure[] {
  return [
    { unit: '%', value: m.avgErrorRate, trend: false },
    { unit: '%', value: m.apiCallsTrend, trend: true },
    { unit: '%', value: m.tokensTrend, trend: true },
    { unit: '%', value: m.responseTimeTrend, trend: true },
    { unit: '%', value: m.costTrend, trend: true },
    { unit: '%', value: m.errorRateTrend, trend: true },
    { unit: 'ms', value: m.avgResponseTime, trend: false },
    { unit: '$', value: m.totalCost, trend: false },
  ]
}

/** Rounds to a number of decimal places, halves up. */
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * The direction a figure is written with. A minus or plus attached to the figure wins. Otherwise the
 * nearest rise or fall word among the few words before it, within the same sentence, gives it. Zero
 * means the text gives no direction.
 */
function signOf(text: string, start: number): Sign {
  const before = text.charAt(start - 1)
  const beforeThat = text.charAt(start - 2)
  if (/[-−–+]/.test(before) && !/[A-Za-z0-9]/.test(beforeThat)) return before === '+' ? 1 : -1
  const sentence = text.slice(0, start).split(/[;:!?\n]|\.(?=\s|$)/).pop() ?? ''
  const words = sentence.trim().split(/\s+/).slice(-DIRECTION_WORDS).reverse()
  for (const word of words) {
    const bare = word.toLowerCase().replace(/[^a-z]/g, '')
    if (RISE_WORDS.has(bare)) return 1
    if (FALL_WORDS.has(bare)) return -1
  }
  return 0
}

/**
 * Whether a figure, with its digits and sign, matches the snapshot. The figure must equal a snapshot value
 * rounded to the figure's own number of decimals. A trend must also carry the sign the text gives it.
 * wrongDirection is set when a trend matches in size only.
 */
function judge(
  value: number,
  decimals: number,
  sign: Sign,
  unit: Unit,
  pool: SnapshotFigure[],
): { matched: boolean; wrongDirection: boolean } {
  let sizeMatched = false
  for (const figure of pool) {
    if (figure.unit !== unit || roundTo(Math.abs(figure.value), decimals) !== value) continue
    sizeMatched = true
    const signMatches = !figure.trend || sign === 0 || (sign < 0 ? figure.value <= 0 : figure.value >= 0)
    if (signMatches) return { matched: true, wrongDirection: false }
  }
  return { matched: false, wrongDirection: sizeMatched }
}

/**
 * Matches each checkable figure in the answer against the snapshot. A figure matches when it equals the
 * snapshot value rounded to the figure's own decimals, so "253 ms" matches 253.4 and "254 ms" does not
 * match 253. A trend figure also needs the direction the text gives it. This shows which numbers come
 * from the data. It does not judge the conclusion drawn from them.
 */
export function checkFigures(text: string, m: Metrics): FigureCheck {
  const pool = snapshotFigures(m)
  const result: FigureCheck = { checked: 0, matched: 0, unmatched: [] }
  for (const match of text.matchAll(FIGURE)) {
    const [whole, dollar, plain, unit] = match
    const isDollar = dollar !== undefined
    const digits = (isDollar ? dollar : plain).replace(/,/g, '')
    const value = Number(digits)
    const decimals = digits.split('.')[1]?.length ?? 0
    const figureUnit: Unit = isDollar ? '$' : unit === 'ms' ? 'ms' : '%'
    const sign: Sign = figureUnit === '%' ? signOf(text, match.index ?? 0) : 0
    const verdict = judge(value, decimals, sign, figureUnit, pool)
    result.checked += 1
    if (verdict.matched) result.matched += 1
    else result.unmatched.push(verdict.wrongDirection ? `${whole.trim()} (direction does not match)` : whole.trim())
  }
  return result
}

/** The one-line result the run trace shows for a figure check. */
export function describeFigureCheck(check: FigureCheck): string {
  if (check.checked === 0) return 'No %, ms or $ figures in the answer to check'
  const noun = check.checked === 1 ? 'figure' : 'figures'
  const verb = check.checked === 1 ? 'matches' : 'match'
  const head = `${check.matched} of ${check.checked} ${noun} ${verb} the snapshot`
  if (check.unmatched.length === 0) return head
  return `${head}. Not in the snapshot: ${check.unmatched.join(', ')}`
}

const REQUIRED_MESSAGE = 'metrics object with totalApiCalls is required'

interface Range {
  min: number
  max: number
}

const TOTAL: Range = { min: 0, max: Infinity }
const RATE: Range = { min: 0, max: 100 }
const TREND: Range = { min: -Infinity, max: Infinity }

type InsightRequest = { ok: true; metrics: Metrics } | { ok: false; error: string }

class FieldError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(source: Record<string, unknown>, field: keyof Metrics, range: Range): number {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new FieldError(`metrics.${field} must be a number`)
  if (value < range.min || value > range.max) throw new FieldError(`metrics.${field} is out of range`)
  return value
}

/**
 * Checks the request body the browser sends. Unknown fields are dropped, and no model name is
 * read from the body. Each figure must be a finite number inside its range.
 */
export function parseInsightRequest(body: unknown): InsightRequest {
  const raw = isRecord(body) ? body.metrics : undefined
  if (!isRecord(raw) || typeof raw.totalApiCalls !== 'number') return { ok: false, error: REQUIRED_MESSAGE }
  try {
    return {
      ok: true,
      metrics: {
        totalApiCalls: readNumber(raw, 'totalApiCalls', TOTAL),
        totalTokens: readNumber(raw, 'totalTokens', TOTAL),
        avgResponseTime: readNumber(raw, 'avgResponseTime', TOTAL),
        totalCost: readNumber(raw, 'totalCost', TOTAL),
        avgErrorRate: readNumber(raw, 'avgErrorRate', RATE),
        apiCallsTrend: readNumber(raw, 'apiCallsTrend', TREND),
        tokensTrend: readNumber(raw, 'tokensTrend', TREND),
        responseTimeTrend: readNumber(raw, 'responseTimeTrend', TREND),
        costTrend: readNumber(raw, 'costTrend', TREND),
        errorRateTrend: readNumber(raw, 'errorRateTrend', TREND),
      },
    }
  } catch (err) {
    if (err instanceof FieldError) return { ok: false, error: err.message }
    throw err
  }
}
