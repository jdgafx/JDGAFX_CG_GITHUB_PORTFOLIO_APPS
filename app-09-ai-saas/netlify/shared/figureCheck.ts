import { halfWindow, type PackageFigures, type Summary } from './contract'
import { contextOf, metricOf, metricsIn, SELECTION_WORDS, weekendMetric, wordsOfFigure, type Context, type Metric } from './attribution'
import { checkEvidence, spikePctOf, writtenDatesAndVersions } from './evidence'
import { comparesWithPast, directionAgrees, figureOccurrences, matchesQuoted, weekendGap, type Quoted, type Range, type Unit } from './figures'

/** The sentence check: every written percentage, count and multiple, read against the values the prompt listed. */

export interface Span {
  start: number
  end: number
}

export interface FigureCheck {
  checked: number
  matched: number
  /** Figures that do not match the value the text gives them: shown as not in the summary. */
  unmatched: string[]
  /** Figures this check could not judge: a figure two metrics fit, a range, a "respectively" list, a plain number. Shown as unchecked. */
  unchecked: string[]
  /** True when the request carried spike evidence, so dates and versions were checked too. */
  withEvidence?: boolean
}

interface PoolValue {
  unit: Unit
  value: number
  metric: Metric
  /** A trend carries a sign. A level, such as a share, is never negative, so its sign is not checked. */
  trend: boolean
  /** The package this value belongs to. Absent for a selection-wide value. */
  owner?: string
  /** For a multiple: the two packages it compares. */
  pair?: [string, string]
}

/** Every number the prompt states, plus the derived ones it spells out, each with its metric and its owner. */
export function pool(s: Summary): PoolValue[] {
  const values: PoolValue[] = [{ unit: 'count', value: s.packages.reduce((sum, p) => sum + p.total, 0), metric: 'total', trend: false }]
  for (const p of s.packages) {
    const own = { owner: p.name, trend: false }
    values.push({ unit: 'count', value: p.total, metric: 'total', ...own }, { unit: 'count', value: p.avgPerDay, metric: 'per_day', ...own })
    values.push({ unit: '%', value: p.sharePct, metric: 'share', ...own })
    if (p.changePct !== null) values.push({ unit: '%', value: p.changePct, metric: 'change', owner: p.name, trend: true })
    if (p.weekendPct !== null) {
      values.push({ unit: '%', value: p.weekendPct, metric: 'weekend_level', ...own }, { unit: '%', value: weekendGap(p.weekendPct), metric: 'weekend_gap', ...own })
    }
  }
  // Multiples between packages, by total and by per-day average, in both directions.
  for (const [i, a] of s.packages.entries()) {
    for (const [k, b] of s.packages.entries()) {
      if (i === k) continue
      const pair: [string, string] = [a.name, b.name]
      if (b.total > 0) values.push({ unit: 'times', value: a.total / b.total, metric: 'total', trend: false, pair })
      if (b.avgPerDay > 0) values.push({ unit: 'times', value: a.avgPerDay / b.avgPerDay, metric: 'per_day', trend: false, pair })
    }
  }
  // A spike is stated as a day's count, the weekday's usual count and the percentage between them.
  for (const spike of s.spikes ?? []) {
    const own = { owner: spike.name, trend: false }
    values.push({ unit: 'count', value: spike.downloads, metric: 'spike_day', ...own }, { unit: 'count', value: spike.baseline, metric: 'baseline', ...own })
    values.push({ unit: '%', value: spikePctOf(spike), metric: 'spike_pct', owner: spike.name, trend: true })
  }
  return values
}

/**
 * A multiple compares two packages, so it must be one the clause's own packages can produce: with two or more named, both
 * of its packages are named; with one named, it involves that one; with none named, none can be told.
 */
function pairNamed(pair: [string, string], named: ReadonlySet<string>): boolean {
  if (named.size >= 2) return named.has(pair[0]) && named.has(pair[1])
  if (named.size === 1) return named.has(pair[0]) || named.has(pair[1])
  return false
}

/**
 * Whether a range ("about 60 to 63%") holds for the packages the clause names: every one of them has a value of the metric
 * inside it, at the bounds' precision. A range is never rejected: when it is not that, or nothing says which packages or
 * which metric, it is unchecked.
 */
export function rangeHolds(range: Range, metric: Metric | null, named: ReadonlySet<string>, packages: PackageFigures[], sign = 0): boolean {
  if (named.size === 0 || metric === null) return false
  const inside = (value: number) => {
    const rounded = Math.round(value * 10 ** range.decimals) / 10 ** range.decimals
    return rounded >= range.low && rounded <= range.high
  }
  return [...named].every((name) => {
    const p = packages.find((candidate) => candidate.name === name)
    if (!p) return false
    if (metric === 'share') return inside(p.sharePct)
    if (metric === 'change') return p.changePct !== null && inside(Math.abs(p.changePct)) && (sign === 0 || (sign < 0 ? p.changePct <= 0 : p.changePct >= 0))
    if (metric === 'weekend_level') return p.weekendPct !== null && inside(p.weekendPct)
    if (metric === 'weekend_gap') return p.weekendPct !== null && inside(weekendGap(p.weekendPct))
    return false
  })
}

/** The packages a multiple's clause names, plus, after a pronoun or with none named, the subject carried in from before. */
function named(ctx: Context): Set<string> {
  return new Set([...ctx.named, ...(ctx.pronoun || ctx.named.length === 0 ? (ctx.subject ? [ctx.subject] : []) : [])])
}

/**
 * Whether a written figure matches a value, and, when it matches in size only, why not. A value that belongs to a package
 * is only read as that package's when the text resolves the figure to it; a figure with no owner matches only values that
 * belong to no package (the selection's total, a multiple with its pair). The metric the words give ("per day", "in
 * total", "usual") must be the value's; when the words give none, the figure must match values of one metric only.
 */
function judge(q: Quoted, values: PoolValue[], ctx: Context, said: Metric | null, clauseAmbiguous: boolean, weekend: Metric | null): { matched: boolean; wrongDirection: boolean; ambiguous: boolean } {
  let sizeMatched = false
  const hits: PoolValue[] = []
  const set = q.unit === 'times' ? named(ctx) : new Set<string>()
  /** Whether the figure may be about this value at all: its unit, its package, its weekend sense and its pair. */
  const admitted = (value: PoolValue): boolean => {
    if (value.unit !== q.unit) return false
    if (value.pair) {
      if (!pairNamed(value.pair as [string, string], set)) return false
    } else if (value.owner !== undefined) {
      if (ctx.owner !== value.owner) return false
    } else if (ctx.owner !== null && !SELECTION_WORDS.test(ctx.clause)) return false // a selection-wide value, in a clause about one package
    // A weekend level ("runs at 57.3% of weekdays") and a weekend gap ("42.7% lower") are told apart by the figure's own words,
    // whether or not it says "weekend"; with words for neither, a weekend value is not matched.
    if ((value.metric === 'weekend_level' || value.metric === 'weekend_gap') && value.metric !== weekend) return false
    // "less than 10 times" is about the larger over the smaller: the inverse ratio would satisfy any upper bound.
    if (q.bound && value.pair && value.value < 1) return false
    return true
  }
  for (const value of values) {
    if (!admitted(value)) continue
    if (!matchesQuoted(q, value.value, value.owner !== undefined)) continue
    sizeMatched = true
    if (value.trend && !directionAgrees(q, value.value)) continue
    hits.push(value)
  }
  // The metric words of the whole clause count too: a figure whose own words say nothing, in a clause that mentions two
  // metrics, is not told apart.
  if (said === null && clauseAmbiguous && q.unit !== 'times') return { matched: false, wrongDirection: false, ambiguous: true }
  const kept = said === null ? hits : hits.filter((value) => value.metric === said)
  // A bare approximation ("nearly 40%") also takes in every admitted value on its side of the figure, not only those inside
  // its band: a band that leaves one metric standing is not a reading the reader can tell apart from the others on that side.
  const side = said === null && q.approx && q.unit !== 'times' ? values.filter((value) => admitted(value) && onSide(q, value.value) && (!value.trend || directionAgrees(q, value.value))) : []
  const metrics = new Set([...kept, ...side].map((value) => value.metric))
  // Without words that name the metric, a figure that fits values of two metrics is not told apart.
  const ambiguous = said === null && q.unit !== 'times' && metrics.size > 1
  return { matched: kept.length > 0 && !ambiguous, wrongDirection: sizeMatched && kept.length === 0 && hits.length === 0, ambiguous }
}

/** Whether a value is on the side of an approximation's figure that the real value lies on: under it for "nearly", over it for "just over". */
function onSide(q: Quoted, value: number): boolean {
  const v = Math.abs(value) / q.scale
  return q.approx === 'below' ? v <= q.value : v >= q.value
}

/**
 * Matches each checkable figure in the answer against the summary. A figure matches when it equals a value of the right
 * metric that belongs to the package the text says it is about, rounded to the figure's own decimals, so "1.2 billion"
 * matches 1,150,000,000 and "1.1 billion" does not. A multiple such as "4.3 times" matches the ratio of two packages'
 * totals or per-day averages. A trend figure also needs the direction the text gives it. This shows which numbers come
 * from the data. It does not judge the conclusion drawn from them. `covered` skips what a structured claim has checked.
 */
export function checkFigures(text: string, s: Summary, covered: (index: number) => boolean = () => false): FigureCheck {
  const values = pool(s)
  const names = s.packages.map((p) => p.name)
  const written = figureOccurrences(text)
  const result: FigureCheck = { checked: 0, matched: 0, unmatched: [], unchecked: [] }
  const handled: Span[] = []
  written.forEach((o) => {
    if (covered(o.index)) return
    const end = o.index + o.whole.length
    handled.push({ start: o.index, end })
    const ctx = contextOf(text, o.index, end, names)
    if (ctx.respectively) {
      result.unchecked.push(o.whole)
      return
    }
    // The words that name a metric are the figure's own: after the delimiter before it, up to the one after it.
    const own = wordsOfFigure(text, o.index, end)
    const unit = o.quoted.unit === 'times' ? null : o.quoted.unit
    // The clause's own metric words speak for a figure only when it is the one figure in the clause.
    const clauseMetrics = unit && figureOccurrences(ctx.clause).length === 1 ? metricsIn(ctx.clause, unit) : []
    const said = unit ? (metricOf(text, own.from, o.index, end, own.to, unit) ?? (clauseMetrics.length === 1 ? clauseMetrics[0] : null)) : null
    if (o.quoted.range) {
      result.checked += 1
      // A range speaks of the packages named before it in its clause, else of those the clause names.
      const subjects = ctx.namedBefore.length > 0 ? new Set(ctx.namedBefore) : named(ctx)
      if (rangeHolds(o.quoted.range, said, subjects, s.packages, o.quoted.sign)) {
        result.checked += 1
        result.matched += 1
      } else result.unchecked.push(o.whole)
      return
    }
    if (o.quoted.unit === 'times' && comparesWithPast(text, end)) {
      result.unchecked.push(o.whole)
      return
    }
    const weekend = unit === '%' ? weekendMetric(text.slice(own.from, o.index), text.slice(end, own.to)) : null
    const verdict = judge(o.quoted, values, ctx, said, clauseMetrics.length > 1, weekend)
    if (verdict.ambiguous) {
      result.unchecked.push(o.whole)
      return
    }
    result.checked += 1
    if (verdict.matched) result.matched += 1
    else result.unmatched.push(verdict.wrongDirection ? `${o.whole} (direction does not match)` : o.whole)
  })
  // Dates and versions are checked only against spike evidence the request carried.
  const evidence = checkEvidence(text, s, covered)
  result.checked += evidence.checked
  result.matched += evidence.matched
  result.unmatched.push(...evidence.unmatched)
  // Every other plain number is either the summary's window length, checked, or shown as unchecked: none is left out.
  const elsewhere = (index: number) => covered(index) || handled.some((span) => index >= span.start && index < span.end)
  const numbers = plainNumbers(text, s, elsewhere)
  result.checked += numbers.matched
  result.matched += numbers.matched
  result.unchecked.push(...numbers.unchecked)
  if (s.spikes !== undefined) result.withEvidence = true
  return result
}

/**
 * The plain numbers in the text that no other check reads: not a dated or versioned figure, a year, or the number of a numbered
 * list. A number of days that is the summary's window, its observed days or a half of the window is checked against those
 * and counts as matched; any other is shown as unchecked, so no number in the answer is left out silently.
 */
function plainNumbers(text: string, s: Summary, elsewhere: (index: number) => boolean): { matched: number; unchecked: string[] } {
  const skip: Span[] = [
    ...writtenDatesAndVersions(text).map((w) => ({ start: w.index, end: w.index + w.text.length })),
    ...[...text.matchAll(/^[ \t]*\d+(?=\.\s)/gm)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length })),
  ]
  const days = [s.windowDays, s.observedDays, halfWindow(s.windowDays)]
  const result = { matched: 0, unchecked: [] as string[] }
  for (const m of text.matchAll(/(?<![\w.,-])\d+(?:,\d{3})*(?:\.\d+)?(?!\w)/g)) {
    const at = m.index ?? 0
    if (elsewhere(at) || skip.some((span) => at >= span.start && at < span.end)) continue
    if (/^(?:19|20)\d{2}$/.test(m[0])) continue // a year
    const isDays = /^[\s-]+days?\b/.test(text.slice(at + m[0].length, at + m[0].length + 12))
    if (isDays && days.includes(Number(m[0]))) result.matched += 1
    else result.unchecked.push(m[0])
  }
  return result
}

/** The one-line result the run trace shows for a figure check. */
export function describeFigureCheck(check: FigureCheck): string {
  const total = check.checked + check.unchecked.length
  if (total === 0) {
    return check.withEvidence
      ? 'No percentage, download-count, date or version figures in the answer to check'
      : 'No percentage or download-count figures in the answer to check'
  }
  const noun = total === 1 ? 'figure' : 'figures'
  const verb = total === 1 ? 'matches' : 'match'
  const head = `${check.matched} of ${total} ${noun} ${verb} the summary${check.withEvidence ? ' and spike evidence' : ''}`
  const counted = check.unchecked.length > 0 ? `${head}; ${check.unchecked.length} unchecked` : head
  if (check.unmatched.length === 0) return counted
  return `${counted}. Not in the summary: ${check.unmatched.join(', ')}`
}
