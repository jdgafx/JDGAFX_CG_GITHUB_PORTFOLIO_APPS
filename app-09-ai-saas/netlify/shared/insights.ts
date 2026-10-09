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
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** How far weekends sit below (or above) weekdays, in percent of the weekday level. */
function weekendGap(weekendPct: number): number {
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

type Sign = 1 | -1 | 0

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

interface Quoted {
  unit: SummaryFigure['unit']
  value: number
  decimals: number
  /** 1 for a figure written out in full, 1e6 for "million", and so on. */
  scale: number
  sign: Sign
}

/** The whole sentence a figure sits in, split the way signOf reads the part before it. */
function sentenceAround(text: string, index: number): string {
  const boundary = /[;:!?\n]|\.(?=\s|$)/
  const before = text.slice(0, index).split(new RegExp(boundary, 'g')).pop() ?? ''
  const after = text.slice(index).split(boundary)[0] ?? ''
  return before + after
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The packages whose names appear in `sentence`. A name inside a longer one (react in react-dom) does not count. */
function namedIn(sentence: string, names: string[]): Set<string> {
  return new Set(names.filter((name) => new RegExp(`(?<![\\w@/.-])${escapeRegExp(name)}(?![\\w/-])`, 'i').test(sentence)))
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

/**
 * Matches each checkable figure in the answer against the summary. A figure matches when it equals the
 * summary value rounded to the figure's own decimals, so "1.2 billion" matches 1,150,000,000 and
 * "1.1 billion" does not. A multiple such as "4.3 times" matches the ratio of two packages' totals or per-day averages. A trend figure also needs the direction the text gives it. This shows which
 * numbers come from the data. It does not judge the conclusion drawn from them.
 */
export function checkFigures(text: string, s: Summary): FigureCheck {
  const pool = summaryFigures(s)
  const names = s.packages.map((p) => p.name)
  const result: FigureCheck = { checked: 0, matched: 0, unmatched: [] }
  for (const match of text.matchAll(FIGURE)) {
    const [whole, percent, scaled, word, grouped, multiple] = match
    const digits = (percent ?? scaled ?? grouped ?? multiple).replace(/,/g, '')
    const unit = percent !== undefined ? '%' : multiple !== undefined ? 'times' : 'count'
    const quoted: Quoted = {
      unit,
      value: Number(digits),
      decimals: digits.split('.')[1]?.length ?? 0,
      scale: word === undefined ? 1 : SCALES[word.toLowerCase()],
      sign: unit === '%' ? signOf(text, match.index ?? 0) : 0,
    }
    const named = unit === 'times' ? namedIn(sentenceAround(text, match.index ?? 0), names) : new Set<string>()
    const verdict = judge(quoted, pool, named)
    result.checked += 1
    if (verdict.matched) result.matched += 1
    else result.unmatched.push(verdict.wrongDirection ? `${whole.trim()} (direction does not match)` : whole.trim())
  }
  // Dates and versions are checked only against spike evidence the request carried.
  const evidence = checkEvidence(text, s)
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
