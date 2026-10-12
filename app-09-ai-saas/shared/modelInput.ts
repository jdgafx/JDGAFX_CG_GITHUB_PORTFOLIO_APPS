import { addDays, fixedDecimal } from './format'
import { topUnusual } from './unusual'
import type { Day, ExplainRequest, PackageFacts, Rows, RunWindow, UnusualRow } from './types'

type PastFlag = 'no-data' | 'possible-gap' | null

/** The rules sent as the system message (spec section 3, rev 7). */
export function SYSTEM_RULES(windowName: string, target: string): string {
  return [
    'You explain npm download data. Code has already computed the exact aggregates (totals, peaks, daily averages) and found the unusual days; trust them. Your job is the reasoning: state and explain growth, compare the packages, and explain the unusual days.',
    'Rules:',
    '1. Code formats every claim for display; you only set the claim fields. What code renders: counts with commas; dates as D Mon YYYY; change_pct with one decimal and its % sign, so never write "percent" after it; a compare as a whole clause naming both packages and the period.',
    '2. Growth: change_pct = (A1/A0 - 1) x 100, where A1 and A0 are the given daily averages. Write it to two decimals with its sign (+12.34 or -4.10) and do no further rounding. If the input says growth is not computable, write no change_pct claim and say growth cannot be computed.',
    `3. Every number and every date you write goes in a claim. Text segments contain no digits and no numbers written as words. Name periods in words only: ${windowName} for the whole window, the past month for the last 30 days, the month before for the 30 days before that. Never count days.`,
    "4. Figure claims: day_value (one day's downloads from the rows given), window_total (span window or last30; copy the given total), peak_value and peak_day (span window), change_pct (span last30), unusual_day (only days listed as unusual), day (any other date in the window). value is digits only for counts, the signed two-decimal number for change_pct, YYYY-MM-DD for peak_day, unusual_day and day. day is YYYY-MM-DD for day_value and the date kinds, else empty. window_total and peak_value are positive whole numbers: where a package's total or peak is zero, write no claim for it and say in words that it had no downloads.",
    `5. Every comparison between packages is a compare claim {package, peer, metric, relation}; code writes its words. Text segments never say which package is larger, smaller, faster, slower, ahead or behind. A compare is a complete clause written by code (for example "react's total for ${windowName} is higher than zod's"): put it in its own sentence, with nothing around it that repeats its sense, and never add a figure claim to stand for a comparison.`,
    "6. One figure per claim: a date and its count are two claims (a date claim, then a day_value claim for that day). At most 8 claims in the paragraph, compare claims included. Cite a peer's figure at most once.",
    '7. Never write ratios, shares, times-larger, differences, combined totals, baselines, counts of days, version numbers or release ids.',
    '8. Rows marked no-data or possible-gap are missing npm data, not real drops. Do not call them unusual and do not quote their value.',
    '9. Releases: name a release as a possible cause of an unusual day only where its row says release same day or release N day(s) before; say so in words (code adds the version). Where the row says no release within 2 days, say the data does not show a cause. Where it says release data unavailable, say the release history could not be loaded; never say there was no release.',
    `10. Write one paragraph about ${target}, at most 120 words, comparing it with the peer packages where useful.`,
  ].join('\n')
}

const DATE = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
const text = (): object => ({
  type: 'object',
  additionalProperties: false,
  required: ['t', 's'],
  properties: { t: { type: 'string', enum: ['text'] }, s: { type: 'string' } },
})
const claimBranch = (names: string[], kinds: string[], valuePattern: string, dayPattern: string): object => ({
  type: 'object',
  additionalProperties: false,
  required: ['t', 'kind', 'package', 'span', 'day', 'value'],
  properties: {
    t: { type: 'string', enum: ['claim'] },
    kind: { type: 'string', enum: kinds },
    package: { type: 'string', enum: names },
    span: { type: 'string', enum: ['window', 'last30', 'none'] },
    day: { type: 'string', pattern: dayPattern },
    value: { type: 'string', pattern: valuePattern },
  },
})
const compareBranch = (names: string[]): object => ({
  type: 'object',
  additionalProperties: false,
  required: ['t', 'package', 'peer', 'metric', 'relation'],
  properties: {
    t: { type: 'string', enum: ['compare'] },
    package: { type: 'string', enum: names },
    peer: { type: 'string', enum: names },
    metric: { type: 'string', enum: ['window_total', 'last30_total', 'change_pct', 'peak_value'] },
    relation: { type: 'string', enum: ['higher', 'lower'] },
  },
})

/** The strict response schema (spec section 3): per-kind claim branches with form patterns, and compare. */
export function CLAIM_SCHEMA(names: string[]): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['paragraph'],
    properties: {
      paragraph: {
        type: 'array',
        items: {
          anyOf: [
            text(),
            // A positive count with no leading zero: the model wrote 0 as a placeholder for a total and a peak (Step 0.5).
            claimBranch(names, ['window_total', 'peak_value'], '^[1-9][0-9]*$', '^$'),
            claimBranch(names, ['day_value'], '^[0-9]+$', DATE),
            claimBranch(names, ['peak_day', 'unusual_day', 'day'], DATE, '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$'),
            claimBranch(names, ['change_pct'], '^[+-][0-9]+[.][0-9]{2}$', '^$'),
            compareBranch(names),
          ],
        },
      },
    },
  }
}

const median = (m: number): string => (Number.isInteger(m) ? String(m) : m.toFixed(1))
const releaseText = (u: UnusualRow): string =>
  u.release === 'unavailable'
    ? 'release data unavailable'
    : u.release === 'none'
      ? 'no release within 2 days'
      : u.release === 0
        ? 'release same day'
        : `release ${u.release} day(s) before`

function growthLine(f: PackageFacts): string {
  const g = f.aggregates.growth
  if (!g.computable) return 'growth: not computable (no downloads in the earlier period)'
  return `daily averages (days with downloads above zero): A1=${fixedDecimal(g.S1, BigInt(g.n1), 4)} (past month, n1=${g.n1}); A0=${fixedDecimal(g.S0, BigInt(g.n0), 4)} (month before, n0=${g.n0})`
}

/**
 * The per-package user message: the run's dates, the target's exact aggregates, its past-month rows,
 * the strongest unusual days and its peers' aggregates. No versions, release ids, shares or counts
 * of unusual days.
 */
export function buildUserMessage(req: ExplainRequest): string {
  const w = req.window
  const me = req.facts.find((f) => f.name === req.target)
  if (!me) throw new Error(`no facts for ${req.target}`)
  const rows = Object.hasOwn(req.pastRows, req.target) ? req.pastRows[req.target]! : []
  const noData = w.noData.filter((d) => d >= w.start && d <= w.L)
  const lines = [
    `RUN_DATE ${w.runDate}; last published day L ${w.L}; window ${w.start}..${w.L} (${w.name}); past month ${w.past[0]}..${w.past[1]}; month before ${w.before[0]}..${w.before[1]}`,
    `no-data days in the window (every package 0, npm gap): ${noData.length > 0 ? noData.join(', ') : 'none'}`,
    `## ${req.target}`,
    `window_total(window)=${me.aggregates.windowTotal}; window_total(last30)=${me.aggregates.last30Total}; peak ${me.aggregates.peakDay}=${me.aggregates.peakValue}`,
    growthLine(me),
    'past month rows (day,downloads[,flag]):',
    ...rows.map(([day, count, flag]) => `${day},${count}${flag ? `,${flag}` : ''}`),
  ]
  const top = topUnusual(me.unusual)
  if (top.length > 0) {
    lines.push('strongest unusual days in the window (day,downloads,same-weekday 8-week median,kind,release):')
    for (const u of top) lines.push(`${u.day},${u.value},${median(u.median)},${u.kind},${releaseText(u)}`)
  } else lines.push('unusual days in the window: none')
  const past = new Set(rows.map((r) => r[0]))
  const earlier = me.possibleGaps.filter((d) => !past.has(d))
  if (earlier.length > 0) lines.push(`possible-gap days earlier in the window: ${earlier.join(', ')}`)
  lines.push('peer packages (exact code aggregates, for comparison only):')
  for (const name of req.names) {
    if (name === req.target) continue
    const q = req.facts.find((f) => f.name === name)
    if (!q) continue
    const g = q.aggregates.growth
    const growth = g.computable ? `A1=${fixedDecimal(g.S1, BigInt(g.n1), 4)} A0=${fixedDecimal(g.S0, BigInt(g.n0), 4)}` : 'growth not computable'
    lines.push(
      `${name}: window_total(window)=${q.aggregates.windowTotal}; window_total(last30)=${q.aggregates.last30Total}; peak ${q.aggregates.peakDay}=${q.aggregates.peakValue}; ${growth}`,
    )
  }
  return lines.join('\n')
}

/** The past-month rows of one package with their flags, as ExplainRequest.pastRows holds them. */
export function buildPastRows(rows: Rows, window: RunWindow, facts: PackageFacts): Array<[Day, number, PastFlag]> {
  const noData = new Set(window.noData)
  const gaps = new Set(facts.possibleGaps)
  const out: Array<[Day, number, PastFlag]> = []
  for (let d = window.past[0]; d <= window.past[1]; d = addDays(d, 1))
    out.push([d, rows[d] ?? 0, noData.has(d) ? 'no-data' : gaps.has(d) ? 'possible-gap' : null])
  return out
}

/**
 * JSON for the request body: the facts hold bigint totals, which JSON.stringify cannot write, so
 * the four bigint fields (aggregates.windowTotal, last30Total, growth.S1, growth.S0) go out as
 * decimal strings and everything else as plain JSON.
 */
export function encodeRequest(req: ExplainRequest): string {
  return JSON.stringify(req, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))
}

/** Inverse of encodeRequest; throws on a bigint field that is not a decimal string. */
export function decodeRequest(textBody: string): ExplainRequest {
  const req = JSON.parse(textBody) as ExplainRequest
  const big = (v: unknown): bigint => {
    if (typeof v !== 'string' || !/^[0-9]+$/.test(v)) throw new Error('bad bigint field')
    return BigInt(v)
  }
  for (const f of req.facts) {
    const a = f.aggregates as unknown as Record<string, unknown>
    const g = f.aggregates.growth as unknown as Record<string, unknown>
    a['windowTotal'] = big(a['windowTotal'])
    a['last30Total'] = big(a['last30Total'])
    g['S1'] = big(g['S1'])
    g['S0'] = big(g['S0'])
  }
  return req
}
