import type { PackageFigures, Summary } from './contract'
import { writtenDatesAndVersions, writtenIsKnown } from './evidence'
import { checkFigures, directionAgrees, figureOccurrences, matchesQuoted, PRONOUN_START_RE, sentenceSpans, weekendGap, type Occurrence } from './insights'

/**
 * Structured claims. The model writes its explanation, then a marker line and a JSON array that says what each figure
 * it wrote is about: a quote copied from the explanation, the kind of figure and the packages it concerns. The server
 * (1) finds each quote verbatim in the explanation, (2) reads the figure from the quote itself and compares it with
 * the one value the claim names, at the precision the text gives, and (3) leaves any figure no claim covers to the
 * older sentence-reading check, which can match it but never rejects it: what it cannot match is shown as unchecked.
 * The model's claim is never trusted for a value, only for what the figure is about.
 */

export const CLAIMS_MARKER = '===CLAIMS==='

export const CLAIM_KINDS = ['total', 'per_day', 'change_pct', 'share_pct', 'weekend_pct', 'multiple', 'difference', 'spike_downloads', 'spike_baseline', 'spike_pct', 'date', 'version'] as const
export type ClaimKind = (typeof CLAIM_KINDS)[number]

export interface Claim {
  /** Words copied from the explanation that contain the figure. */
  q: string
  k: ClaimKind
  /** Packages the figure is about: one, or two for a multiple (the first is the one said to be larger). */
  p: string[]
  /** For a multiple: which figure the ratio is of. Absent means either. */
  m?: 'total' | 'per_day'
  /** For a spike kind: the spike's day. Absent means any of the package's spikes. */
  d?: string
}

const MAX_CLAIMS = 80

/** The instructions that ask for the claims. They come after the explanation instructions in the prompt. */
export function claimsPrompt(): string {
  return `

After the explanation, write a new line containing exactly ${CLAIMS_MARKER} and then a JSON array and nothing else (no code fence). Write one object for each number, percentage, multiple, date or version you wrote in the explanation:
{"q": words copied exactly from the explanation that contain the figure, at most 8 words, "k": what the figure is, "p": an array of the package names from the list above it is about, "m": "total" or "per_day" (multiples and differences), "d": the spike's date as YYYY-MM-DD (spike kinds only; leave the key out otherwise)}
For example: [{"q":"9.4 times","k":"multiple","p":["zod","@anthropic-ai/sdk"],"m":"total"},{"q":"40.1%","k":"share_pct","p":["zod"]}]
"k" is one of: total (a package's total downloads, or the selection's when "p" is empty), per_day (downloads per day), change_pct (the change between the halves), share_pct (share of the selection), weekend_pct (the weekend level or its gap to weekdays), multiple (N times: "p" has two packages, the one the sentence is about and names first, then the other), difference (the gap between two packages' downloads: "p" has both, "m" says total or per_day), spike_downloads, spike_baseline, spike_pct (a spike's day count, usual count, or percentage above usual), date, version.`
}

/** Passes text through until the claims marker, holding back just enough to see a marker split across chunks. */
export class ClaimSplitter {
  private held = ''
  found = false

  push(delta: string): string {
    if (this.found) return ''
    const all = this.held + delta
    const at = all.indexOf(CLAIMS_MARKER)
    if (at >= 0) {
      this.found = true
      this.held = ''
      return all.slice(0, at).trimEnd()
    }
    const keep = CLAIMS_MARKER.length - 1
    if (all.length <= keep) {
      this.held = all
      return ''
    }
    this.held = all.slice(-keep)
    return all.slice(0, -keep)
  }

  /** What was held back, once the stream ends without a marker. */
  flush(): string {
    const rest = this.found ? '' : this.held
    this.held = ''
    return rest
  }
}

/** The explanation and the raw claims text of a whole answer. `claimsRaw` is null when the model wrote no marker. */
export function splitAnswer(full: string): { explanation: string; claimsRaw: string | null } {
  const at = full.indexOf(CLAIMS_MARKER)
  if (at < 0) return { explanation: full, claimsRaw: null }
  return { explanation: full.slice(0, at).trimEnd(), claimsRaw: full.slice(at + CLAIMS_MARKER.length).trim() }
}

/** Reads the claims array. A code fence around it is tolerated. Null when it is not valid JSON of the expected shape. */
export function parseClaims(raw: string): Claim[] | null {
  let json: unknown
  try {
    json = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
  } catch {
    return null
  }
  if (!Array.isArray(json) || json.length > MAX_CLAIMS) return null
  const claims: Claim[] = []
  for (const entry of json) {
    if (typeof entry !== 'object' || entry === null) return null
    const { q, k, p, m, d } = entry as Record<string, unknown>
    if (typeof q !== 'string' || q === '' || !CLAIM_KINDS.includes(k as ClaimKind)) return null
    // A single string is read as one entry; the checker splits it when it holds several names.
    const said = typeof p === 'string' ? [p] : p
    if (!Array.isArray(said) || !said.every((name) => typeof name === 'string') || said.length > 5) return null
    claims.push({
      q,
      k: k as ClaimKind,
      p: said as string[],
      ...(m === 'total' || m === 'per_day' ? { m } : {}),
      ...(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? { d } : {}),
    })
  }
  return claims
}

const words = (value: string): string[] => value.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part !== '')

/**
 * Finds the selection's package a claim means. An exact name, or the name after the scope, matches first; then a name
 * whose words include all of the claim's words ("the SDK", "Anthropic SDK" for @anthropic-ai/sdk), if that is one
 * package only. Null when nothing or more than one package fits.
 */
export function resolvePackage(said: string, names: string[]): string | null {
  const lower = said.trim().toLowerCase().replace(/^the\s+/, '')
  const exact = names.filter((name) => name.toLowerCase() === lower || name.toLowerCase().split('/').pop() === lower)
  if (exact.length === 1) return exact[0]
  const wanted = words(lower).filter((word) => word !== 'package' && word !== 'library')
  if (wanted.length === 0) return null
  const fits = names.filter((name) => wanted.every((word) => words(name).includes(word)))
  return fits.length === 1 ? fits[0] : null
}

/** The packages a claim names. An entry that is not one package but several names run together ("zod react") is split. */
export function resolvePackages(said: string[], names: string[]): (string | null)[] {
  return said.flatMap((entry) => {
    const whole = resolvePackage(entry, names)
    if (whole !== null || !/\s/.test(entry.trim())) return [whole]
    const parts = entry.trim().split(/[\s,;]+/).map((part) => resolvePackage(part, names))
    return parts.every((part) => part !== null) ? parts : [null]
  })
}

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
    case 'multiple': {
      if (!a || !b) return null
      const ratios = (metric: 'total' | 'per_day') => {
        const top = metric === 'total' ? a.total : a.avgPerDay
        const bottom = metric === 'total' ? b.total : b.avgPerDay
        return bottom > 0 && top > 0 ? [top / bottom, bottom / top] : []
      }
      return { values: claim.m ? ratios(claim.m) : [...ratios('total'), ...ratios('per_day')], trend: false }
    }
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

const UNIT: Partial<Record<ClaimKind, Occurrence['quoted']['unit']>> = {
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

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where in `text` (from `from` up to `to`) a package is named: its name, the name after its scope, a word of it, or what the claim called it. Index, or -1. */
function mentionAt(text: string, from: number, to: number, name: string, said: string[], names: string[]): number {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4)
  const callings = said.filter((entry) => resolvePackage(entry, names) === name).map((entry) => entry.trim().replace(/^the\s+/i, ''))
  const aliases = [name, name.split('/').pop() ?? name, ...words, ...callings].filter((alias) => alias.length > 0)
  const region = text.slice(from, to)
  let best = -1
  for (const alias of aliases) {
    const at = region.search(new RegExp(`(?<![\\w@/.-])${escapeRe(alias)}(?![\\w-])`, 'i'))
    if (at >= 0 && (best < 0 || at < best)) best = at
  }
  return best < 0 ? -1 : from + best
}

/**
 * Whether the text around a claimed figure really speaks of the packages the claim names. The model is trusted for
 * what a figure is about only as far as the words show it. A package must be named in the figure's sentence, or, when
 * that sentence opens with a pronoun or names no package, in the sentences just before it. A multiple also needs its
 * subject (p[0]) named before the figure and its other package named in the quote or just after the figure, before the
 * next figure, so a ratio cannot be borrowed for a different pair.
 */
function attributed(text: string, claim: Claim, quoteEnd: number, figureEnd: number, names: string[], said: string[]): boolean {
  if (claim.p.length === 0) return true
  const spans = sentenceSpans(text)
  const at = Math.max(0, spans.findIndex((span) => quoteEnd - 1 >= span.start && quoteEnd - 1 <= span.end))
  const own = text.slice(spans[at].start, spans[at].end)
  const namesNone = names.every((name) => mentionAt(own, 0, own.length, name, [], names) < 0)
  const reach = PRONOUN_START_RE.test(own) || namesNone ? Math.max(0, at - 3) : at
  const from = spans[reach].start
  const to = spans[at].end
  const mention = (name: string, f: number, t: number) => mentionAt(text, f, t, name, said, names)
  if (claim.k === 'multiple' && claim.p.length >= 2) {
    const subject = mention(claim.p[0], from, quoteEnd)
    const nextFigure = figureOccurrences(text).find((found) => found.index >= figureEnd)?.index ?? to
    const other = mention(claim.p[1], text.indexOf(claim.q), Math.min(to, nextFigure))
    return subject >= 0 && other >= 0 && subject < other
  }
  return claim.p.every((name) => mention(name, from, to) >= 0)
}

/** Counts a claim of a count kind could be mistaken for when it names a single package: gaps between packages and combined figures. */
function derivedCounts(packages: PackageFigures[]): number[] {
  const values = [packages.reduce((sum, pkg) => sum + pkg.total, 0), packages.reduce((sum, pkg) => sum + pkg.avgPerDay, 0)]
  for (const [i, a] of packages.entries()) {
    for (const b of packages.slice(i + 1)) values.push(Math.abs(a.total - b.total), Math.abs(a.avgPerDay - b.avgPerDay))
  }
  return values
}

/**
 * Checks an explanation against its claims. Figures inside a verified claim are judged by the claim; every other
 * figure goes to the sentence check, whose misses are reported as unchecked rather than rejected. A claim whose
 * packages the text does not name around the figure is unchecked, and so is a count claim that fails but equals a
 * gap or a combined figure the claim kinds of one package cannot represent.
 */
export function checkClaims(text: string, claims: Claim[], s: Summary): ClaimCheck {
  const names = s.packages.map((pkg) => pkg.name)
  const result: ClaimCheck = { checked: 0, matched: 0, rejected: [], unchecked: [], ignored: 0, claims: claims.length, withEvidence: s.spikes !== undefined }
  const covered: { start: number; end: number }[] = []
  const reject = (figure: string, quote: string, start: number) => result.rejected.push({ figure, quote, start, end: start + figure.length })
  const leaveUnchecked = (figure: string, start: number) => {
    covered.push({ start, end: start + figure.length })
    result.unchecked.push(figure)
  }

  for (const claim of claims) {
    const at = text.indexOf(claim.q)
    const packages = resolvePackages(claim.p, names)
    if (at < 0 || packages.some((name) => name === null)) {
      result.ignored += 1
      continue
    }
    const resolved: Claim = { ...claim, p: packages as string[] }

    if (claim.k === 'date' || claim.k === 'version') {
      const item = writtenDatesAndVersions(claim.q).find((found) => found.kind === claim.k)
      if (!item) {
        result.ignored += 1
        continue
      }
      const start = at + item.index
      if (!attributed(text, resolved, at + claim.q.length, start + item.text.length, names, claim.p)) {
        leaveUnchecked(item.text, start)
        continue
      }
      covered.push({ start, end: start + item.text.length })
      result.checked += 1
      if (writtenIsKnown(item, s, resolved.p[0])) result.matched += 1
      else reject(item.text, claim.q, start)
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
    if (!attributed(text, resolved, at + claim.q.length, start + figure.whole.length, names, claim.p)) {
      leaveUnchecked(figure.whole, start)
      continue
    }
    covered.push({ start, end: start + figure.whole.length })
    // The figure's direction is read from the whole explanation, where the words before it are.
    const quoted = figureOccurrences(text).find((found) => found.index === start)?.quoted ?? figure.quoted
    const ok = expected.values.some((value) => matchesQuoted(quoted, value) && (!expected.trend || directionAgrees(quoted, value)))
    if (ok) {
      result.checked += 1
      result.matched += 1
    } else if (unit === 'count' && derivedCounts(s.packages).some((value) => matchesQuoted(quoted, value))) {
      result.unchecked.push(figure.whole)
    } else {
      result.checked += 1
      reject(figure.whole, claim.q, start)
    }
  }

  const isCovered = (index: number) => covered.some((span) => index >= span.start && index < span.end)
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
