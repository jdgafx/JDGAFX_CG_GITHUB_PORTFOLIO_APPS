import type { PackageFigures, Summary } from './contract'
import { contextOf, mentionsIn, segmentsOf, wordsOfFigure } from './attribution'
import { writtenDatesAndVersions, writtenIsKnown } from './evidence'
import { checkFigures } from './figureCheck'
import { directionAgrees, figureOccurrences, matchesQuoted, weekendGap, type Unit } from './figures'
import { resolvePackages, type Claim, type ClaimKind } from './claims'
import { allowedCounts, PARTIAL_COUNT, qualifierOf, readSpikeCount, scopeOfCount, writtenSpikeCounts } from './spikeCounts'

/**
 * Checks an explanation against its claims. Figures inside a verified claim are judged by the claim; every other figure
 * goes to the sentence check, whose misses are reported as unchecked rather than rejected. Attribution is the shared
 * resolver's (attribution.ts) in both: a claim only counts when the text itself says the figure is about the package the
 * claim names.
 */

export interface ClaimCheck {
  /** Figures checked: verified claims plus unclaimed figures the sentence check could match. */
  checked: number
  matched: number
  /** Claims whose figure did not match the value they name. `figure` is the figure as written, `quote` the claim's words. */
  rejected: { figure: string; quote: string; start: number; end: number }[]
  /** Figures no claim covers that the sentence check could not match. Shown neutrally. */
  unchecked: string[]
  /** Claims set aside: quote not in the explanation, package not in the selection, or no figure in the quote. */
  ignored: number
  claims: number
  withEvidence: boolean
}

function expectedValues(claim: Claim, packages: PackageFigures[], s: Summary): { values: number[]; trend: boolean } | null {
  const [a, b] = claim.p.map((name) => packages.find((pkg) => pkg.name === name))
  const spikes = (s.spikes ?? []).filter((spike) => spike.name === claim.p[0] && (claim.d === undefined || spike.date === claim.d))
  switch (claim.k) {
    case 'total':
      return { values: [claim.p.length === 0 ? packages.reduce((sum, pkg) => sum + pkg.total, 0) : (a?.total ?? NaN)], trend: false }
    case 'per_day':
      return { values: [a?.avgPerDay ?? NaN], trend: false }
    case 'change_pct':
      return a && a.changePct !== null ? { values: [a.changePct], trend: true } : null
    case 'share_pct':
      return { values: [a?.sharePct ?? NaN], trend: false }
    case 'weekend_pct':
      return a && a.weekendPct !== null ? { values: [a.weekendPct, weekendGap(a.weekendPct)], trend: false } : null
    case 'multiple':
      return a && b ? { values: ratios(a, b, claim.m), trend: false } : null
    case 'difference': {
      if (!a || !b) return null
      const gaps = (metric: 'total' | 'per_day') => [Math.abs((metric === 'total' ? a.total : a.avgPerDay) - (metric === 'total' ? b.total : b.avgPerDay))]
      return { values: claim.m ? gaps(claim.m) : [...gaps('total'), ...gaps('per_day')], trend: false }
    }
    case 'spike_downloads':
      return { values: spikes.map((spike) => spike.downloads), trend: false }
    case 'spike_baseline':
      return { values: spikes.map((spike) => spike.baseline), trend: false }
    case 'spike_pct':
      return { values: spikes.map((spike) => spike.sizePct), trend: true }
    default:
      return null
  }
}

/** The ratios of a to b and of b to a, by the metric given or by both. */
function ratios(a: PackageFigures, b: PackageFigures, metric?: 'total' | 'per_day'): number[] {
  const one = (m: 'total' | 'per_day') => {
    const top = m === 'total' ? a.total : a.avgPerDay
    const bottom = m === 'total' ? b.total : b.avgPerDay
    return bottom > 0 && top > 0 ? [top / bottom, bottom / top] : []
  }
  return metric ? one(metric) : [...one('total'), ...one('per_day')]
}

const UNIT: Partial<Record<ClaimKind, Unit>> = {
  total: 'count',
  per_day: 'count',
  spike_downloads: 'count',
  spike_baseline: 'count',
  change_pct: '%',
  share_pct: '%',
  weekend_pct: '%',
  spike_pct: '%',
  multiple: 'times',
  difference: 'count',
}

/** Counts a claim of a count kind could be mistaken for when it names a single package: gaps between packages and combined figures. */
function derivedCounts(packages: PackageFigures[]): number[] {
  const values = [packages.reduce((sum, pkg) => sum + pkg.total, 0), packages.reduce((sum, pkg) => sum + pkg.avgPerDay, 0)]
  for (const [i, a] of packages.entries()) {
    for (const b of packages.slice(i + 1)) values.push(Math.abs(a.total - b.total), Math.abs(a.avgPerDay - b.avgPerDay))
  }
  return values
}

/** The packages named in the sentence the figure sits in and, when that sentence opens with a pronoun or names none, in the sentences just before it. */
function packagesAround(text: string, at: number, names: string[]): string[] {
  const segments = segmentsOf(text)
  const i = Math.max(0, segments.findIndex((seg) => at >= seg.start && at <= seg.end))
  const own = mentionsIn(text, names, segments[i].start, segments[i].end)
  const ctx = contextOf(text, at, at, names)
  const from = ctx.pronoun || own.length === 0 ? segments[Math.max(0, i - 3)].start : segments[i].start
  return [...new Set(mentionsIn(text, names, from, segments[i].end).map((m) => m.name))]
}

/**
 * Whether the text says a ratio is between the claim's packages in the claim's order: the subject (p[0]) named before the
 * figure and the other package named inside the quote or just after the figure, before the next figure.
 */
function pairInOrder(text: string, claim: Claim, quoteAt: number, figureEnd: number, names: string[]): boolean {
  const quoteEnd = quoteAt + claim.q.length
  const segments = segmentsOf(text)
  const i = Math.max(0, segments.findIndex((seg) => quoteEnd - 1 >= seg.start && quoteEnd - 1 <= seg.end))
  const ctx = contextOf(text, quoteAt, figureEnd, names)
  const own = mentionsIn(text, names, segments[i].start, segments[i].end)
  const from = ctx.pronoun || own.length === 0 ? segments[Math.max(0, i - 3)].start : segments[i].start
  const first = (name: string, f: number, t: number) => mentionsIn(text, names, f, t).find((m) => m.name === name)?.at ?? -1
  const subject = first(claim.p[0], from, quoteEnd)
  const nextFigure = figureOccurrences(text).find((found) => found.index >= figureEnd)?.index ?? segments[i].end
  const other = first(claim.p[1], quoteAt, Math.min(segments[i].end, nextFigure, wordsOfFigure(text, figureEnd - 1, figureEnd).to))
  return subject >= 0 && other >= 0 && subject < other
}

/** Whether every package a claim names is named by the text around the figure. */
function allNamed(text: string, claim: Claim, at: number, names: string[]): boolean {
  const around = packagesAround(text, at, names)
  return claim.p.every((name) => around.includes(name))
}

export function checkClaims(text: string, claims: Claim[], s: Summary): ClaimCheck {
  const names = s.packages.map((pkg) => pkg.name)
  const result: ClaimCheck = { checked: 0, matched: 0, rejected: [], unchecked: [], ignored: 0, claims: claims.length, withEvidence: s.spikes !== undefined }
  const covered: { start: number; end: number }[] = []
  const reject = (figure: string, quote: string, start: number) => result.rejected.push({ figure, quote, start, end: start + figure.length })
  const leaveUnchecked = (figure: string, start: number) => {
    covered.push({ start, end: start + figure.length })
    result.unchecked.push(figure)
  }
  const verdict = (ok: boolean, figure: string, quote: string, start: number) => {
    covered.push({ start, end: start + figure.length })
    result.checked += 1
    if (ok) result.matched += 1
    else reject(figure, quote, start)
  }

  for (const claim of claims) {
    const at = text.indexOf(claim.q)
    const packages = resolvePackages(claim.p, names)
    if (at < 0 || packages.some((name) => name === null)) {
      result.ignored += 1
      continue
    }
    const resolved: Claim = { ...claim, p: packages as string[] }

    if (claim.k === 'spike_count') {
      const read = readSpikeCount(claim.q)
      if (read === null) {
        result.ignored += 1
        continue
      }
      if (read === 'ambiguous') {
        result.ignored += 1
        continue
      }
      const start = at + read.count.index
      const scope = resolved.p.length > 0 ? resolved.p[0] : scopeOfCount(text, { ...read.count, index: start }, names)
      // A claim for one package is only checked when the text says the count is that package's.
      const ctxOwner = contextOf(text, start, start + read.count.text.length, names).owner
      const attributed = scope === 'unresolved' ? false : resolved.p.length === 0 ? true : ctxOwner === resolved.p[0] || allNamed(text, resolved, start, names)
      const allowed = scope === 'unresolved' ? null : allowedCounts(s, scope, read.qualifier)
      if (PARTIAL_COUNT.test(claim.q) || !attributed || allowed === null) leaveUnchecked(read.count.text, start)
      else verdict(allowed.includes(read.count.value), read.count.text, claim.q, start)
      continue
    }

    if (claim.k === 'date' || claim.k === 'version') {
      const item = writtenDatesAndVersions(claim.q).find((found) => found.kind === claim.k)
      if (!item) {
        result.ignored += 1
        continue
      }
      const start = at + item.index
      if (!allNamed(text, resolved, start, names)) leaveUnchecked(item.text, start)
      else verdict(writtenIsKnown(item, s, resolved.p[0]), item.text, claim.q, start)
      continue
    }

    const unit = UNIT[claim.k]
    const figure = figureOccurrences(claim.q).find((found) => found.quoted.unit === unit)
    const expected = expectedValues(resolved, s.packages, s)
    if (!figure || !expected || (claim.k !== 'total' && claim.p.length === 0)) {
      result.ignored += 1
      continue
    }
    const start = at + figure.index
    const end = start + figure.whole.length
    // The figure's direction and hedge are read from the whole explanation, where the words around it are.
    const quoted = figureOccurrences(text).find((found) => found.index === start)?.quoted ?? figure.quoted
    const fits = (values: number[], hedge: boolean) => values.some((value) => matchesQuoted(quoted, value, hedge) && (!expected.trend || directionAgrees(quoted, value)))

    if (claim.k === 'multiple' || claim.k === 'difference') {
      const inOrder = claim.k === 'multiple' ? pairInOrder(text, resolved, at, end, names) : allNamed(text, resolved, start, names)
      if (inOrder) {
        verdict(fits(expected.values, claim.k === 'difference'), figure.whole, claim.q, start)
        continue
      }
      // The claim's pair is not the one the text speaks of. Judge the ratio against every pair the text does name: a ratio
      // no named pair gives is wrong; one that another named pair gives is a claim about the wrong pair, left unchecked.
      const around = packagesAround(text, start, names)
      const pairs = around.flatMap((a, i) => around.slice(i + 1).map((b) => [a, b] as const))
      const others = pairs.flatMap(([a, b]) => {
        const [pa, pb] = [s.packages.find((p) => p.name === a), s.packages.find((p) => p.name === b)]
        return pa && pb ? ratios(pa, pb, claim.m) : []
      })
      if (claim.k === 'multiple' && pairs.length > 0 && !fits(others, false)) verdict(false, figure.whole, claim.q, start)
      else leaveUnchecked(figure.whole, start)
      continue
    }

    // A figure about one package is only checked when the text says it is about that package.
    const owner = contextOf(text, start, end, names).owner
    if (claim.p.length > 0 && owner !== resolved.p[0]) {
      leaveUnchecked(figure.whole, start)
      continue
    }
    if (fits(expected.values, true)) verdict(true, figure.whole, claim.q, start)
    else if (unit === 'count' && fits(derivedCounts(s.packages), false)) leaveUnchecked(figure.whole, start)
    else verdict(false, figure.whole, claim.q, start)
  }

  // Counts of unusual days the claims did not cover: checked here, or left unchecked when they cannot be told.
  const isCovered = (index: number) => covered.some((span) => index >= span.start && index < span.end)
  for (const { count, clause } of writtenSpikeCounts(text)) {
    if (isCovered(count.index)) continue
    const scope = scopeOfCount(text, count, names)
    const allowed = scope === 'unresolved' ? null : allowedCounts(s, scope, qualifierOf(clause))
    const around = text.slice(Math.max(0, count.index - 24), count.index + count.text.length + 20)
    if (PARTIAL_COUNT.test(around) || allowed === null) leaveUnchecked(count.text, count.index)
    else verdict(allowed.includes(count.value), count.text, clause.trim(), count.index)
  }

  const rest = checkFigures(text, s, isCovered)
  result.checked += rest.matched
  result.matched += rest.matched
  result.unchecked.push(...rest.unmatched)
  return result
}

/** The one-line result the run trace shows for a claims check. */
export function describeClaimCheck(check: ClaimCheck): string {
  if (check.checked === 0 && check.unchecked.length === 0) return 'No figures in the answer to check'
  const noun = check.checked === 1 ? 'figure' : 'figures'
  const verb = check.checked === 1 ? 'matches' : 'match'
  const parts = [`${check.matched} of ${check.checked} ${noun} ${verb} the summary${check.withEvidence ? ' and spike evidence' : ''}`]
  if (check.unchecked.length > 0) parts.push(`${check.unchecked.length} unchecked`)
  const head = parts.join('; ')
  return check.rejected.length === 0 ? head : `${head}. Not in the summary: ${check.rejected.map((r) => r.figure).join(', ')}`
}
