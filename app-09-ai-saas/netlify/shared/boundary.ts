import { isPackageName } from '../../shared/packageName'
import type { Day, ExplainRequest, FigureKind, PackageFacts, RunWindow, Segment, UnusualRow, WindowDays } from '../../shared/types'

/** The deployed site. A request's own origin is allowed too, so deploy previews work (SYSTEM.md C11). */
export const PRODUCTION_ORIGIN = 'https://jdgafx-app-09-ai-saas.netlify.app'
export const MAX_BODY_BYTES = 32 * 1024
export const MAX_NAMES = 4
export const MAX_ROWS = 60
export const MAX_UNUSUAL = 6
/** The longest list of days a request may carry: the window is at most 365 days. */
const MAX_DAYS = 400

type Loose = Record<string, unknown>

function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** No Origin header, the production origin, or the origin of the request's own URL. Cross-site is refused. */
export function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (origin === null || origin === PRODUCTION_ORIGIN) return true
  return origin === new URL(req.url).origin
}

export type TextResult = { ok: true; text: string } | { ok: false; message: string }

/** Reads the body as text with a declared-size check and a measured byte cap (32 KB), before anything is parsed. */
export async function readText(req: Request): Promise<TextResult> {
  const tooLarge = { ok: false, message: 'The request is too large.' } as const
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return tooLarge
  if (!req.body) return { ok: false, message: 'The request body is empty.' }
  const reader = req.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return tooLarge
    }
    text += decoder.decode(value, { stream: true })
  }
  return { ok: true, text: text + decoder.decode() }
}

function isDay(value: unknown): value is Day {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function dayList(value: unknown): Day[] | null {
  return Array.isArray(value) && value.length <= MAX_DAYS && value.every(isDay) ? (value as Day[]) : null
}

/** The decoded request carries real bigints (WP1's wire format); anything else is refused. */
function bigintOf(value: unknown): bigint | null {
  return typeof value === 'bigint' && value >= 0n ? value : null
}

const WINDOW_NAMES: Record<WindowDays, RunWindow['name']> = { 30: 'the past month', 90: 'the past three months', 365: 'the past year' }

function readWindow(value: unknown): RunWindow | null {
  if (!isRecord(value)) return null
  const { runDate, L, days, start } = value
  if (!isDay(runDate) || !isDay(L) || !isDay(start)) return null
  if (days !== 30 && days !== 90 && days !== 365) return null
  const name = WINDOW_NAMES[days]
  if (value.name !== name) return null
  const noData = dayList(value.noData)
  const pair = (v: unknown): [Day, Day] | null => (Array.isArray(v) && v.length === 2 && isDay(v[0]) && isDay(v[1]) ? [v[0], v[1]] : null)
  const past = pair(value.past)
  const before = pair(value.before)
  return noData && past && before ? { runDate, L, days, start, noData, past, before, name } : null
}

function readUnusual(value: unknown): UnusualRow | null {
  if (!isRecord(value)) return null
  const { day, value: count, median, kind, release, version } = value
  if (!isDay(day) || !isCount(count)) return null
  if (typeof median !== 'number' || !Number.isFinite(median) || median < 0) return null
  if (kind !== 'spike' && kind !== 'drop') return null
  if (release !== 0 && release !== 1 && release !== 2 && release !== 'none' && release !== 'unavailable') return null
  if (version !== undefined && (typeof version !== 'string' || version.length > 100)) return null
  return version === undefined ? { day, value: count, median, kind, release } : { day, value: count, median, kind, release, version }
}

function readFacts(value: unknown, name: string): PackageFacts | null {
  if (!isRecord(value) || value.name !== name || !isRecord(value.aggregates) || !isRecord(value.aggregates.growth)) return null
  const a = value.aggregates
  const g = a.growth as Loose
  const windowTotal = bigintOf(a.windowTotal)
  const last30Total = bigintOf(a.last30Total)
  const S1 = bigintOf(g.S1)
  const S0 = bigintOf(g.S0)
  if (windowTotal === null || last30Total === null || S1 === null || S0 === null) return null
  if (!isDay(a.peakDay) || !isCount(a.peakValue) || !isCount(g.n1) || !isCount(g.n0) || typeof g.computable !== 'boolean') return null
  // Growth that claims to be computable divides by n1, n0 and S0 (shared/modelInput fixedDecimal): none may be zero.
  if (g.computable && (g.n1 === 0 || g.n0 === 0 || S0 === 0n)) return null
  if (!Array.isArray(value.unusual) || value.unusual.length > MAX_UNUSUAL) return null
  const unusual = value.unusual.map(readUnusual)
  const possibleGaps = dayList(value.possibleGaps)
  const notAssessed = dayList(value.notAssessed)
  if (unusual.some((row) => row === null) || !possibleGaps || !notAssessed) return null
  return {
    name,
    aggregates: { windowTotal, last30Total, peakDay: a.peakDay, peakValue: a.peakValue, growth: { S1, n1: g.n1, S0, n0: g.n0, computable: g.computable } },
    unusual: unusual as UnusualRow[],
    possibleGaps,
    notAssessed,
  }
}

type PastRow = ExplainRequest['pastRows'][string][number]

function readRows(value: unknown): PastRow[] | null {
  if (!Array.isArray(value) || value.length > MAX_ROWS) return null
  const rows: PastRow[] = []
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== 3) return null
    const [day, count, flag] = row as unknown[]
    if (!isDay(day) || !isCount(count)) return null
    if (flag !== null && flag !== 'no-data' && flag !== 'possible-gap') return null
    rows.push([day, count, flag])
  }
  return rows
}

export type RequestResult = { ok: true; request: ExplainRequest } | { ok: false; message: string }

/**
 * Checks the decoded request (shared/modelInput decodeRequest) and builds a typed ExplainRequest from it; unknown
 * fields are dropped. 1 to 4 names, the target among them, at most 60 rows and 6 unusual rows per package, release state ok or failed.
 */
export function validateExplainRequest(value: unknown): RequestResult {
  const refuse = (message: string): RequestResult => ({ ok: false, message })
  if (!isRecord(value)) return refuse('The request must be a JSON object.')
  const { target, names } = value
  if (!Array.isArray(names) || names.length < 1 || names.length > MAX_NAMES) return refuse(`The request needs 1 to ${MAX_NAMES} package names.`)
  if (!names.every(isPackageName) || new Set(names.map((n) => n.toLowerCase())).size !== names.length) return refuse('Each package name must be a distinct, valid npm name.')
  if (typeof target !== 'string' || !names.includes(target)) return refuse('The target must be one of the names.')
  const window = readWindow(value.window)
  if (!window) return refuse('The window is not valid.')
  const sentFacts = value.facts
  if (!Array.isArray(sentFacts) || sentFacts.length !== names.length) return refuse('The request needs one set of facts per name.')
  const facts = names.map((name, i) => readFacts(sentFacts[i], name))
  if (facts.some((f) => f === null)) return refuse('The facts are not valid.')
  const pastRows: ExplainRequest['pastRows'] = {}
  const sentRows = isRecord(value.pastRows) ? value.pastRows : {}
  for (const name of names) {
    if (!Object.hasOwn(sentRows, name)) continue
    const rows = readRows(sentRows[name])
    if (!rows) return refuse(`The rows for ${name} are not valid (at most ${MAX_ROWS}, each a day and a whole count of 0 or more).`)
    pastRows[name] = rows
  }
  if (!Object.hasOwn(pastRows, target)) return refuse('The target needs its rows.')
  const releaseState: ExplainRequest['releaseState'] = {}
  const sentState = isRecord(value.releaseState) ? value.releaseState : {}
  for (const name of names) {
    const state = Object.hasOwn(sentState, name) ? sentState[name] : undefined
    if (state !== 'ok' && state !== 'failed') return refuse('Each package needs a release state of ok or failed.')
    releaseState[name] = state
  }
  return { ok: true, request: { target, names: names as string[], window, facts: facts as PackageFacts[], pastRows, releaseState } }
}

const KINDS = ['day_value', 'window_total', 'peak_value', 'peak_day', 'change_pct', 'unusual_day', 'day']
const SPANS = ['window', 'last30', 'none']
const METRICS = ['window_total', 'last30_total', 'change_pct', 'peak_value']

/**
 * The model's decoded answer as segments, or null when it is not a non-empty list of well-formed segments naming
 * only the requested packages. This checks structure, never the prose or the figures: judging is the browser's.
 */
export function parseParagraph(value: unknown, names: string[]): Segment[] | null {
  if (!isRecord(value) || !Array.isArray(value.paragraph) || value.paragraph.length === 0) return null
  const known = (v: unknown): v is string => typeof v === 'string' && names.includes(v)
  const out: Segment[] = []
  for (const seg of value.paragraph as unknown[]) {
    if (!isRecord(seg)) return null
    if (seg.t === 'text' && typeof seg.s === 'string') {
      out.push({ t: 'text', s: seg.s })
    } else if (seg.t === 'claim' && typeof seg.kind === 'string' && KINDS.includes(seg.kind) && known(seg.package) && typeof seg.span === 'string' && SPANS.includes(seg.span) && typeof seg.day === 'string' && typeof seg.value === 'string') {
      out.push({ t: 'claim', kind: seg.kind as FigureKind, package: seg.package, span: seg.span as 'window' | 'last30' | 'none', day: seg.day, value: seg.value })
    } else if (seg.t === 'compare' && known(seg.package) && known(seg.peer) && typeof seg.metric === 'string' && METRICS.includes(seg.metric) && (seg.relation === 'higher' || seg.relation === 'lower')) {
      out.push({ t: 'compare', package: seg.package, peer: seg.peer, metric: seg.metric as 'window_total' | 'last30_total' | 'change_pct' | 'peak_value', relation: seg.relation })
    } else {
      return null
    }
  }
  return out
}
