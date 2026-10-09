import { halfWindow, isValidPackageName, MAX_PACKAGES, type PackageFigures, type Summary } from './contract'
import { checkEvidence, parseSpikes, spikePrompt } from './evidence'

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}%`
}

/** Whole-number count with thousands separators, the form the figure check reads back. */
function count(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/** Rounds to a number of decimal places, halves up. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** How far weekends sit below (or above) weekdays, in percent of the weekday level. */
export function weekendGap(weekendPct: number): number {
  return roundTo(Math.abs(100 - weekendPct), 1)
}

function packageLine(p: PackageFigures, withShare: boolean): string {
  const change = p.changePct === null ? 'not available (the earlier half had no downloads)' : signed(p.changePct)
  const weekend =
    p.weekendPct === null
      ? 'not available'
      : `weekend days run at ${p.weekendPct}% of weekday downloads (${weekendGap(p.weekendPct)}% ${p.weekendPct <= 100 ? 'lower' : 'higher'})`
  const share = withShare ? `; ${p.sharePct}% of the selection's downloads` : ''
  return `- ${p.name}: ${count(p.total)} downloads in total; ${count(p.avgPerDay)} per day on average; change ${change}; ${weekend}${share}`
}

/** The prompt. It states only the summary figures and asks for plain text. */
export function buildPrompt(s: Summary): string {
  const half = halfWindow(s.windowDays)
  const noun = s.packages.length === 1 ? 'this npm package' : `these ${s.packages.length} npm packages`
  return `You are an expert in the JavaScript ecosystem. Analyze the daily download figures for ${noun} from the public npm registry and give 4-5 concise, specific insights.

Window: ${s.startDate} to ${s.endDate} (${s.windowDays} days, ${s.observedDays} of them with data from npm). "Change" compares the last ${half} days with the ${half} days before them, per day with data.

Packages:
${s.packages.map((p) => packageLine(p, s.packages.length > 1)).join('\n')}
${spikePrompt(s)}
Use only the figures listed above. Do not invent numbers, rankings, versions, release dates or reasons stated as fact; explain a pattern only as a possibility. Quote a download count in full or in millions or billions (for example 1.2 billion). You may state how many times larger one package is than another, using the listed figures. When you compare packages, say which one is growing fastest and which slowest using the change figures. Downloads count installs, including CI and mirrors, so they measure install volume, not users. Be direct and actionable. Format as numbered insights with brief explanations.

Output plain text only. Do not use markdown headings, asterisks, or any other markup.`
}

export type Sign = 1 | -1 | 0

/**
 * A figure the check can match: a percentage, a count with a scale word (1.2 billion, 41k), a count
 * with thousands separators (35,968,597), or a multiple (4.3 times, 11x). Plain small numbers and the day window are not figures to check.
 */
const FIGURE =
  /(?<![\d.,])(?:(\d[\d,]*(?:\.\d+)?)\s?%(?![A-Za-z])|(\d[\d,]*(?:\.\d+)?)\s?(billion|million|thousand|bn|[kKMB])(?![A-Za-z])|(\d{1,3}(?:,\d{3})+)(?!\d|,\d)|(\d+(?:\.\d+)?)\s?(?:times|x)(?![A-Za-z]))/g

const SCALES: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9 }

/** Words that say a trend rose, and words that say it fell. Only these set the direction of a figure. */
const RISE_WORDS = new Set(['up', 'rose', 'rise', 'rises', 'rising', 'grew', 'grow', 'grows', 'growing', 'increased', 'increase', 'higher', 'climbed', 'jumped', 'gained'])
const FALL_WORDS = new Set(['down', 'fell', 'fall', 'falls', 'falling', 'dropped', 'drop', 'decreased', 'decrease', 'declined', 'decline', 'lower', 'reduced', 'lost', 'shrank'])

/** How many words before a figure, in the same sentence, are read for its direction. */
const DIRECTION_WORDS = 4

interface FigureCheck {
  checked: number
  matched: number
  unmatched: string[]
  /** True when the request carried spike evidence, so dates and versions were checked too. */
  withEvidence?: boolean
}

interface SummaryFigure {
  unit: '%' | 'count' | 'times'
  value: number
  /** A trend carries a sign. A level, such as a share, is never negative, so its sign is not checked. */
  trend: boolean
  /** For a multiple: the two packages it compares, so it only matches in a sentence that names them. */
  pair?: [string, string]
}

/** Every number the prompt states, plus the derived ones it spells out. */
function summaryFigures(s: Summary): SummaryFigure[] {
  const figures: SummaryFigure[] = [{ unit: 'count', value: s.packages.reduce((sum, p) => sum + p.total, 0), trend: false }]
  for (const p of s.packages) {
    figures.push({ unit: 'count', value: p.total, trend: false }, { unit: 'count', value: p.avgPerDay, trend: false })
    figures.push({ unit: '%', value: p.sharePct, trend: false })
    if (p.changePct !== null) figures.push({ unit: '%', value: p.changePct, trend: true })
    if (p.weekendPct !== null) {
      figures.push({ unit: '%', value: p.weekendPct, trend: false }, { unit: '%', value: weekendGap(p.weekendPct), trend: false })
    }
  }
  // Multiples between packages, by total and by per-day average, in both directions.
  for (const [i, a] of s.packages.entries()) {
    for (const [k, b] of s.packages.entries()) {
      if (i === k) continue
      const pair: [string, string] = [a.name, b.name]
      if (b.total > 0) figures.push({ unit: 'times', value: a.total / b.total, trend: false, pair })
      if (b.avgPerDay > 0) figures.push({ unit: 'times', value: a.avgPerDay / b.avgPerDay, trend: false, pair })
    }
  }
  // A spike is stated as a day's count, the weekday's usual count and the percentage between them.
  for (const spike of s.spikes ?? []) {
    figures.push(
      { unit: 'count', value: spike.downloads, trend: false },
      { unit: 'count', value: spike.baseline, trend: false },
      { unit: '%', value: spike.sizePct, trend: true },
    )
  }
  return figures
}

/**
 * The direction a figure is written with. A minus or plus attached to the figure wins. Otherwise the
 * nearest rise or fall word among the few words before it, within the same sentence, gives it. Zero
 * means the text gives no direction.
 */
export function signOf(text: string, start: number): Sign {
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

export interface Quoted {
  unit: SummaryFigure['unit']
  value: number
  decimals: number
  /** 1 for a figure written out in full, 1e6 for "million", and so on. */
  scale: number
  sign: Sign
}

/** The sentences of `text` as character spans, split the way signOf reads the part before a figure. */
function sentenceSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  let start = 0
  for (const match of text.matchAll(/[;:!?\n]|\.(?=\s|$)/g)) {
    spans.push({ start, end: match.index ?? 0 })
    start = (match.index ?? 0) + 1
  }
  spans.push({ start, end: text.length })
  return spans
}

/** A sentence that starts with one of these is about the package the sentence before it was about. */
const PRONOUN_START = /^\W*(?:it|its|this|that|the (?:package|library))\b/i
/** How many sentences back a pronoun's package is looked for. */
const PRONOUN_REACH = 3

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The packages named in `sentence`, in the order they appear. */
function namedInOrder(sentence: string, names: string[]): string[] {
  return names
    .map((name) => ({ name, at: sentence.search(new RegExp(`(?<![\\w@/.-])${escapeRegExp(name)}(?![\\w/-])`, 'i')) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((hit) => hit.name)
}

/**
 * The packages sets a figure's sentence can be read with: the packages it names and, when it opens with a pronoun
 * ("It is 1.4 times react's total"), those plus the first package named in the nearest earlier sentence. A figure
 * passes under either reading, so a sentence that names its own subject is not pushed onto the previous one's.
 */
function packagesForFigure(text: string, index: number, names: string[]): Set<string>[] {
  const spans = sentenceSpans(text)
  const at = Math.max(0, spans.findIndex((span) => index >= span.start && index <= span.end))
  const own = new Set(namedInOrder(text.slice(spans[at].start, spans[at].end), names))
  const readings = [own]
  if (PRONOUN_START.test(text.slice(spans[at].start, spans[at].end))) {
    for (let back = at - 1; back >= Math.max(0, at - PRONOUN_REACH); back--) {
      const subject = namedInOrder(text.slice(spans[back].start, spans[back].end), names)[0]
      if (subject !== undefined) {
        readings.push(new Set([...own, subject]))
        break
      }
    }
  }
  return readings
}

/**
 * A multiple compares two packages, so it must be one the sentence's own packages can produce: with two or more
 * named, both of its packages are named; with one named, it involves that one; with none named, any pair will do.
 */
function pairNamed(pair: [string, string], named: ReadonlySet<string>): boolean {
  if (named.size >= 2) return named.has(pair[0]) && named.has(pair[1])
  if (named.size === 1) return named.has(pair[0]) || named.has(pair[1])
  return true
}

/**
 * Whether a quoted figure matches the summary. It must equal a summary value, divided by the figure's own
 * scale and rounded to the figure's own decimals. A trend must also carry the sign the text gives it.
 * wrongDirection is set when a trend matches in size only.
 */
function judge(q: Quoted, pool: SummaryFigure[], named: ReadonlySet<string>): { matched: boolean; wrongDirection: boolean } {
  let sizeMatched = false
  for (const figure of pool) {
    if (figure.unit !== q.unit || roundTo(Math.abs(figure.value) / q.scale, q.decimals) !== q.value) continue
    if (figure.pair && !pairNamed(figure.pair, named)) continue
    sizeMatched = true
    const signMatches = !figure.trend || q.sign === 0 || (q.sign < 0 ? figure.value <= 0 : figure.value >= 0)
    if (signMatches) return { matched: true, wrongDirection: false }
  }
  return { matched: false, wrongDirection: sizeMatched }
}

/** A checkable figure written in the text: where it starts, how it is written and what it says. Its sign is read from the text around it. */
export interface Occurrence {
  index: number
  whole: string
  quoted: Quoted
}

/** Every percentage, count and multiple written in `text`, in order. */
export function figureOccurrences(text: string): Occurrence[] {
  return [...text.matchAll(FIGURE)].map((match) => {
    const [whole, percent, scaled, word, grouped, multiple] = match
    const digits = (percent ?? scaled ?? grouped ?? multiple).replace(/,/g, '')
    const unit = percent !== undefined ? '%' : multiple !== undefined ? 'times' : 'count'
    return {
      index: match.index ?? 0,
      whole: whole.trim(),
      quoted: {
        unit,
        value: Number(digits),
        decimals: digits.split('.')[1]?.length ?? 0,
        scale: word === undefined ? 1 : SCALES[word.toLowerCase()],
        sign: unit === '%' ? signOf(text, match.index ?? 0) : 0,
      } satisfies Quoted,
    }
  })
}

/** Whether `value`, divided by the figure's own scale and rounded to its own decimals, is what the figure says. */
export function matchesQuoted(q: Quoted, value: number): boolean {
  return roundTo(Math.abs(value) / q.scale, q.decimals) === q.value
}

/** Whether the direction the text gives a trend figure agrees with the real value. A figure with no direction in the text passes. */
export function directionAgrees(q: Quoted, value: number): boolean {
  return q.sign === 0 || (q.sign < 0 ? value <= 0 : value >= 0)
}

/**
 * Matches each checkable figure in the answer against the summary. A figure matches when it equals the
 * summary value rounded to the figure's own decimals, so "1.2 billion" matches 1,150,000,000 and
 * "1.1 billion" does not. A multiple such as "4.3 times" matches the ratio of two packages' totals or per-day averages. A trend figure also needs the direction the text gives it. This shows which
 * numbers come from the data. It does not judge the conclusion drawn from them.
 */
export function checkFigures(text: string, s: Summary, covered: (index: number) => boolean = () => false): FigureCheck {
  const pool = summaryFigures(s)
  const names = s.packages.map((p) => p.name)
  const result: FigureCheck = { checked: 0, matched: 0, unmatched: [] }
  for (const { index, whole, quoted } of figureOccurrences(text)) {
    if (covered(index)) continue
    // A multiple can be read with the packages its sentence names, or with the subject a leading "It" points to.
    const sets = quoted.unit === 'times' ? packagesForFigure(text, index, names) : [new Set<string>()]
    const verdicts = sets.map((named) => judge(quoted, pool, named))
    const verdict = verdicts.find((v) => v.matched) ?? verdicts[0]
    result.checked += 1
    if (verdict.matched) result.matched += 1
    else result.unmatched.push(verdict.wrongDirection ? `${whole} (direction does not match)` : whole)
  }
  // Dates and versions are checked only against spike evidence the request carried.
  const evidence = checkEvidence(text, s, covered)
  result.checked += evidence.checked
  result.matched += evidence.matched
  result.unmatched.push(...evidence.unmatched)
  if (s.spikes !== undefined) result.withEvidence = true
  return result
}

/** The one-line result the run trace shows for a figure check. */
export function describeFigureCheck(check: FigureCheck): string {
  if (check.checked === 0) {
    return check.withEvidence
      ? 'No percentage, download-count, date or version figures in the answer to check'
      : 'No percentage or download-count figures in the answer to check'
  }
  const noun = check.checked === 1 ? 'figure' : 'figures'
  const verb = check.checked === 1 ? 'matches' : 'match'
  const head = `${check.matched} of ${check.checked} ${noun} ${verb} the summary${check.withEvidence ? ' and spike evidence' : ''}`
  if (check.unmatched.length === 0) return head
  return `${head}. Not in the summary: ${check.unmatched.join(', ')}`
}

const REQUIRED_MESSAGE = 'summary object with packages is required'

const MAX_WINDOW_DAYS = 400
const MAX_COUNT = 1e13
const DATE = /^\d{4}-\d{2}-\d{2}$/

type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

export type InsightRequest = { ok: true; summary: Summary } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Midnight UTC of a YYYY-MM-DD date, or NaN when the text is not a real calendar date. */
function dayNumber(date: string): number {
  const time = DATE.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== date ? NaN : time / 86_400_000
}

function readNumber(source: Record<string, unknown>, field: string, path: string, min: number, max: number): Checked<number> {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: `${path}.${field} must be a number` }
  if (value < min || value > max) return { ok: false, error: `${path}.${field} is out of range` }
  return { ok: true, value }
}

/** Like readNumber, but null is a valid answer: the figure could not be worked out. */
function readNullable(source: Record<string, unknown>, field: string, path: string, min: number, max: number): Checked<number | null> {
  return source[field] === null ? { ok: true, value: null } : readNumber(source, field, path, min, max)
}

function readPackage(raw: unknown, index: number): Checked<PackageFigures> {
  const path = `summary.packages[${index}]`
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` }
  if (typeof raw.name !== 'string' || !isValidPackageName(raw.name)) {
    return { ok: false, error: `${path}.name must be a valid npm package name` }
  }
  const total = readNumber(raw, 'total', path, 0, MAX_COUNT)
  if (!total.ok) return total
  const avgPerDay = readNumber(raw, 'avgPerDay', path, 0, MAX_COUNT)
  if (!avgPerDay.ok) return avgPerDay
  const changePct = readNullable(raw, 'changePct', path, -100, 1e7)
  if (!changePct.ok) return changePct
  const weekendPct = readNullable(raw, 'weekendPct', path, 0, 1e5)
  if (!weekendPct.ok) return weekendPct
  const sharePct = readNumber(raw, 'sharePct', path, 0, 100)
  if (!sharePct.ok) return sharePct
  return {
    ok: true,
    value: {
      name: raw.name,
      total: total.value,
      avgPerDay: avgPerDay.value,
      changePct: changePct.value,
      weekendPct: weekendPct.value,
      sharePct: sharePct.value,
    },
  }
}

function readDates(raw: Record<string, unknown>): Checked<Pick<Summary, 'startDate' | 'endDate' | 'windowDays'>> {
  const { startDate, endDate } = raw
  if (typeof startDate !== 'string' || Number.isNaN(dayNumber(startDate))) {
    return { ok: false, error: 'summary.startDate must be a date as YYYY-MM-DD' }
  }
  if (typeof endDate !== 'string' || Number.isNaN(dayNumber(endDate))) {
    return { ok: false, error: 'summary.endDate must be a date as YYYY-MM-DD' }
  }
  const windowDays = dayNumber(endDate) - dayNumber(startDate) + 1
  if (windowDays < 2 || windowDays > MAX_WINDOW_DAYS) return { ok: false, error: 'summary dates must span 2 to 400 days' }
  if (raw.windowDays !== windowDays) return { ok: false, error: 'summary.windowDays must match the dates' }
  return { ok: true, value: { startDate, endDate, windowDays } }
}

/**
 * Checks the request body the browser sends. Unknown fields are dropped, and no model name is read
 * from the body. Names must be valid npm names, the arrays are capped, and each figure must be a
 * finite number inside its range.
 */
export function parseInsightRequest(body: unknown): InsightRequest {
  const raw = isRecord(body) ? body.summary : undefined
  if (!isRecord(raw) || !Array.isArray(raw.packages)) return { ok: false, error: REQUIRED_MESSAGE }
  if (raw.packages.length < 1 || raw.packages.length > MAX_PACKAGES) {
    return { ok: false, error: `summary.packages needs 1 to ${MAX_PACKAGES} entries` }
  }
  const dates = readDates(raw)
  if (!dates.ok) return dates
  const observed = readNumber(raw, 'observedDays', 'summary', 1, dates.value.windowDays)
  if (!observed.ok) return observed
  if (!Number.isInteger(observed.value)) return { ok: false, error: 'summary.observedDays must be a whole number' }

  const packages: PackageFigures[] = []
  for (const [index, entry] of raw.packages.entries()) {
    const figures = readPackage(entry, index)
    if (!figures.ok) return figures
    packages.push(figures.value)
  }
  if (new Set(packages.map((p) => p.name)).size !== packages.length) {
    return { ok: false, error: 'summary.packages must not repeat a package' }
  }
  const spikes = parseSpikes(raw.spikes, new Set(packages.map((p) => p.name)), { start: dates.value.startDate, end: dates.value.endDate })
  if (!spikes.ok) return spikes
  return {
    ok: true,
    summary: { ...dates.value, observedDays: observed.value, packages, ...(spikes.value ? { spikes: spikes.value } : {}) },
  }
}
