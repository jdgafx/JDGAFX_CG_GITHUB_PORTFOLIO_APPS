import { describe, expect, it } from 'vitest'
import {
  buildPrompt,
  checkFigures,
  COMPARISON_DAYS,
  describeFigureCheck,
  METRIC_COUNT,
  parseInsightRequest,
  type Metrics,
} from '../../netlify/shared/insights'

const SNAPSHOT: Metrics = {
  totalApiCalls: 540000,
  totalTokens: 812000000,
  avgResponseTime: 253,
  totalCost: 1234.5,
  avgErrorRate: 1.25,
  apiCallsTrend: 30.9,
  tokensTrend: 29.6,
  responseTimeTrend: -13.5,
  costTrend: 18.2,
  errorRateTrend: -4.1,
}

describe('buildPrompt', () => {
  const prompt = buildPrompt(SNAPSHOT)

  it('states each figure with its sign and the comparison window', () => {
    expect(prompt).toContain('- Total API Calls: 540,000 (+30.9% vs prev 15 days)')
    expect(prompt).toContain('- Total Tokens: 812,000,000 (+29.6% vs prev 15 days)')
    expect(prompt).toContain('- Average Response Time: 253ms (-13.5% vs prev 15 days)')
    expect(prompt).toContain('- Error Rate: 1.25% of requests (-4.1% vs prev 15 days)')
    expect(prompt).toContain('- Total Cost: $1234.5 (+18.2% vs prev 15 days)')
  })

  it('carries ten figures: five values, each with a trend', () => {
    expect(METRIC_COUNT).toBe(10)
    expect(prompt.match(/vs prev 15 days/g)?.length).toBe(5)
    expect(COMPARISON_DAYS).toBe(15)
  })

  it('asks for plain text and forbids invented numbers', () => {
    expect(prompt).toContain('Output plain text only.')
    expect(prompt).toContain('Do not invent percentages, rankings, or per-endpoint or per-customer numbers.')
  })
})

describe('checkFigures', () => {
  it('matches every figure that comes from the snapshot', () => {
    const text =
      'API calls rose 30.9% and tokens 29.6%. Latency fell 13.5% to 253 ms. Spend is $1,234.50 and errors sit at 1.25% of requests.'
    expect(checkFigures(text, SNAPSHOT)).toEqual({ checked: 6, matched: 6, unmatched: [] })
  })

  it('names each figure that is not in the snapshot', () => {
    expect(checkFigures('Latency is 250 ms. The top 10% of endpoints drive 60% of calls.', SNAPSHOT)).toEqual({
      checked: 3,
      matched: 0,
      unmatched: ['250 ms', '10%', '60%'],
    })
  })

  it('rejects figures that a 0.5 percent tolerance would have accepted', () => {
    // $1,240 is within 0.5% of 1234.5, and 254 ms is within 0.5% of 253. Neither equals its snapshot value.
    expect(checkFigures('Spend reached $1,240 and latency 254 ms.', SNAPSHOT)).toEqual({
      checked: 2,
      matched: 0,
      unmatched: ['$1,240', '254 ms'],
    })
  })

  it('matches a snapshot value rounded to the decimals the figure is written with', () => {
    const precise: Metrics = { ...SNAPSHOT, avgResponseTime: 253.4, apiCallsTrend: 30.94, totalCost: 57.35 }
    expect(
      checkFigures('Latency 253 ms and 254 ms. Calls up 30.9%, 30.94% and 30.95%. Spend $57.35 or $57.', precise),
    ).toEqual({ checked: 7, matched: 5, unmatched: ['254 ms', '30.95%'] })
  })

  it('reads the direction of a trend from a rise or fall word before it', () => {
    expect(checkFigures('API calls rose 30.9%, and latency fell 13.5%.', SNAPSHOT)).toEqual({
      checked: 2,
      matched: 2,
      unmatched: [],
    })
    expect(checkFigures('Latency rose 13.5% this week.', SNAPSHOT)).toEqual({
      checked: 1,
      matched: 0,
      unmatched: ['13.5% (direction does not match)'],
    })
  })

  it('reads a minus or plus sign attached to a trend figure', () => {
    expect(checkFigures('Calls moved -30.9%, and tokens +29.6%.', SNAPSHOT)).toEqual({
      checked: 2,
      matched: 1,
      unmatched: ['30.9% (direction does not match)'],
    })
  })

  it('does not check the direction of a level such as the error rate', () => {
    expect(checkFigures('The error rate fell to 1.25% of requests.', SNAPSHOT)).toEqual({
      checked: 1,
      matched: 1,
      unmatched: [],
    })
  })

  it('reads direction only from the sentence the figure is in', () => {
    expect(checkFigures('Calls rose sharply in the first half. Latency was 13.5%.', SNAPSHOT)).toEqual({
      checked: 1,
      matched: 1,
      unmatched: [],
    })
  })

  it('does not check plain counts or the day window', () => {
    expect(checkFigures('We served 540,000 calls over 15 days.', SNAPSHOT)).toEqual({
      checked: 0,
      matched: 0,
      unmatched: [],
    })
  })
})

describe('describeFigureCheck', () => {
  it('gives the count and names the figures that do not match', () => {
    expect(describeFigureCheck({ checked: 6, matched: 6, unmatched: [] })).toBe('6 of 6 figures match the snapshot')
    expect(describeFigureCheck({ checked: 3, matched: 0, unmatched: ['250 ms', '10%', '60%'] })).toBe(
      '0 of 3 figures match the snapshot. Not in the snapshot: 250 ms, 10%, 60%',
    )
  })

  it('uses the singular for one figure and says when there is none', () => {
    expect(describeFigureCheck({ checked: 1, matched: 1, unmatched: [] })).toBe('1 of 1 figure matches the snapshot')
    expect(describeFigureCheck({ checked: 0, matched: 0, unmatched: [] })).toBe(
      'No %, ms or $ figures in the answer to check',
    )
  })
})

describe('parseInsightRequest', () => {
  it('returns the snapshot and drops any other field, including a model name', () => {
    expect(parseInsightRequest({ metrics: { ...SNAPSHOT, model: 'openai/gpt-4o' } })).toEqual({
      ok: true,
      metrics: SNAPSHOT,
    })
  })

  it('asks for the metrics object when it is missing or is not an object', () => {
    const required = { ok: false, error: 'metrics object with totalApiCalls is required' }
    expect(parseInsightRequest({})).toEqual(required)
    expect(parseInsightRequest(null)).toEqual(required)
    expect(parseInsightRequest({ metrics: [] })).toEqual(required)
    expect(parseInsightRequest({ metrics: { ...SNAPSHOT, totalApiCalls: '540000' } })).toEqual(required)
  })

  it('rejects a field of the wrong type and names it', () => {
    expect(parseInsightRequest({ metrics: { ...SNAPSHOT, totalTokens: 'lots' } })).toEqual({
      ok: false,
      error: 'metrics.totalTokens must be a number',
    })
    expect(parseInsightRequest({ metrics: { ...SNAPSHOT, costTrend: null } })).toEqual({
      ok: false,
      error: 'metrics.costTrend must be a number',
    })
  })

  it('rejects a negative total, and an error rate above 100', () => {
    expect(parseInsightRequest({ metrics: { ...SNAPSHOT, totalCost: -1 } })).toEqual({
      ok: false,
      error: 'metrics.totalCost is out of range',
    })
    expect(parseInsightRequest({ metrics: { ...SNAPSHOT, avgErrorRate: 150 } })).toEqual({
      ok: false,
      error: 'metrics.avgErrorRate is out of range',
    })
  })

  it('accepts negative trends, which are real declines', () => {
    expect(parseInsightRequest({ metrics: { ...SNAPSHOT, responseTimeTrend: -40 } }).ok).toBe(true)
  })
})
