import { halfWindow, isValidPackageName, MAX_PACKAGES, type PackageFigures, type Summary } from './contract'
import { parseSpikeCounts, parseSpikes, spikePrompt } from './evidence'
import { weekendGap } from './figures'

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}%`
}

/** Whole-number count with thousands separators, the form the figure check reads back. */
function count(value: number): string {
  return Math.round(value).toLocaleString('en-US')
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

export { checkFigures, describeFigureCheck } from './figureCheck'

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
  const spikeCounts = parseSpikeCounts(raw.spikeCounts, new Set(packages.map((p) => p.name)))
  if (!spikeCounts.ok) return spikeCounts
  return {
    ok: true,
    summary: { ...dates.value, observedDays: observed.value, packages, ...(spikes.value ? { spikes: spikes.value } : {}), ...(spikeCounts.value ? { spikeCounts: spikeCounts.value } : {}) },
  }
}
