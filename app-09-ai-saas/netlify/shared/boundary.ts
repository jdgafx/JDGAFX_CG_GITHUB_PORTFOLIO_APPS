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
  // Growth that claims to be computable divides by n1, n0 and S0 (growthPercent in shared/aggregates): none may be zero.
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

const KINDS = ['day_value', 'window_total', 'window_days', 'peak_value', 'peak_day', 'change_pct', 'unusual_day', 'day']
const SPANS = ['window', 'last30', 'none']
const METRICS = ['window_total', 'last30_total', 'change_pct', 'peak_value']

/** What a figure claim states, whatever value or span the model wrote for it: two claims with one key say the same thing. */
function figureKey(seg: Exclude<Segment, { t: 'text' }>): string {
  if (seg.t === 'compare') return `${seg.package}|${seg.peer}|${seg.metric}`
  // the past month is its own figure; any other span is the whole window
  const part = seg.kind === 'day_value' ? seg.day : seg.kind === 'unusual_day' || seg.kind === 'day' ? seg.value : seg.kind === 'window_total' || seg.kind === 'window_days' ? String(seg.span === 'last30') : ''
  return `${seg.kind}|${seg.package}|${part}`
}

/** Words that end in a stop without ending the sentence ("vs. ", "e.g. ", "approx. "). "etc." and "No." can end one, so they are not here. */
const ABBREVIATION = /(?:^|[^a-z])(?:e\.g|i\.e|vs|approx|cf|ca|fig|mr|mrs|ms|dr|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)$/i

/** Where sentences end in the model's text: a stop before a space or the end, after a word that is not an abbreviation. A decimal point ("4.5") or a thousands comma ("29,696,229") is no stop. */
function stopsIn(s: string): number[] {
  return [...s.matchAll(/[.!?](?=\s|$)/g)].filter((m) => m[0] !== '.' || !ABBREVIATION.test(s.slice(0, m.index))).map((m) => m.index)
}

/**
 * A dropped claim leaves its sentence with a hole ("Across the past year, ___ is compared below."). When a dropped
 * segment has words of its own sentence right beside it (the nearest segment on a side that is not blank text: its
 * text has words before the stop on that side), that sentence is cut whole: from the stop before it to the stop that
 * ends it, kept claims inside it included. A blank or empty text segment between is not a neighbour: "On ", "", dropped
 * date, 29,696,229 still has "On" beside the hole. A kept claim beside the drop fills the hole (two claims side by side
 * are one phrase). Text outside that sentence is unchanged, and a dropped segment with no such words beside it changes
 * nothing. `work` holds null where a segment was dropped; only those first drops start a cut, and a cut segment becomes null.
 */
function cutBrokenSentences(work: Array<Segment | null>): void {
  const dropped = work.flatMap((seg, i) => (seg === null ? [i] : []))
  for (const i of dropped) {
    let broken = false
    const gone: number[] = []
    let backKeep: { at: number; s: string } | null = null
    let forwardKeep: { at: number; s: string } | null = null
    let beside = true
    for (let j = i - 1; j >= 0; j--) {
      const seg = work[j]
      if (!seg) continue
      if (seg.t === 'text' && seg.s.trim() === '') {
        gone.push(j)
        continue
      }
      const edge = beside
      beside = false
      if (seg.t !== 'text') {
        gone.push(j)
        continue
      }
      const last = stopsIn(seg.s).at(-1)
      const cut = last === undefined ? 0 : last + 1
      if (edge && seg.s.slice(cut).trim() !== '') broken = true
      if (last === undefined) {
        gone.push(j)
        continue
      }
      backKeep = { at: j, s: seg.s.slice(0, cut) + (/^\s*/.exec(seg.s.slice(cut))?.[0] ?? '') }
      break
    }
    beside = true
    for (let j = i + 1; j < work.length; j++) {
      const seg = work[j]
      if (!seg) continue
      if (seg.t === 'text' && seg.s.trim() === '') {
        gone.push(j)
        continue
      }
      const edge = beside
      beside = false
      if (seg.t !== 'text') {
        gone.push(j)
        continue
      }
      const first = stopsIn(seg.s)[0]
      if (edge && seg.s.slice(0, first ?? seg.s.length).trim() !== '') broken = true
      if (first === undefined) {
        gone.push(j)
        continue
      }
      forwardKeep = { at: j, s: seg.s.slice(first + 1) }
      break
    }
    if (!broken) continue
    for (const j of gone) work[j] = null
    for (const keep of [backKeep, forwardKeep]) if (keep) work[keep.at] = { t: 'text', s: keep.s }
  }
}

/**
 * The paragraph a package is shown with (rev 8.3, rev 8.4). Nothing is added. These are dropped: an empty text segment,
 * a claim about a package other than `target` (a compare must name it), a claim that states a figure already stated
 * (the first stays, whatever value the later one carries), and a figure claim with no text of words and no other claim
 * on either side. A sentence that a dropped claim sat in is dropped whole (rev 8.4), so no half sentence reaches the
 * page; the rest of the model's text is byte for byte. Every later step (figure numbers, checks, the figure table) sees
 * only what is kept.
 */
function tidy(segments: Segment[], target: string): Segment[] {
  const seen = new Set<string>()
  const work = segments.map((seg): Segment | null => {
    if (seg.t === 'text') return seg
    if (seg.t === 'compare' ? seg.package !== target && seg.peer !== target : seg.package !== target) return null
    const key = figureKey(seg)
    return seen.has(key) ? null : (seen.add(key), seg)
  })
  cutBrokenSentences(work)
  const kept = work.filter((seg): seg is Segment => seg !== null && !(seg.t === 'text' && seg.s === ''))
  const anchored = (seg: Segment | undefined): boolean => seg?.t === 'claim' || (seg?.t === 'text' && seg.s.trim() !== '')
  return kept.filter((seg, i) => seg.t !== 'claim' || anchored(kept[i - 1]) || anchored(kept[i + 1]))
}

/**
 * The model's decoded answer as segments, or null when it is not a non-empty list of well-formed segments naming
 * only the requested packages. This checks structure, never the prose or the figures: judging is the browser's.
 * What the browser is shown is `tidy`'d for `target`.
 */
export function parseParagraph(value: unknown, names: string[], target: string): Segment[] | null {
  if (!isRecord(value) || !Array.isArray(value.paragraph) || value.paragraph.length === 0) return null
  const known = (v: unknown): v is string => typeof v === 'string' && names.includes(v)
  const out: Segment[] = []
  for (const seg of value.paragraph as unknown[]) {
    if (!isRecord(seg)) return null
    if (seg.t === 'text' && typeof seg.s === 'string') {
      out.push({ t: 'text', s: seg.s })
    } else if (seg.t === 'claim' && typeof seg.kind === 'string' && KINDS.includes(seg.kind) && known(seg.package) && typeof seg.span === 'string' && SPANS.includes(seg.span) && typeof seg.day === 'string' && typeof seg.value === 'string') {
      out.push({ t: 'claim', kind: seg.kind as FigureKind, package: seg.package, span: seg.span as 'window' | 'last30' | 'none', day: seg.day, value: seg.value })
    } else if (seg.t === 'compare' && known(seg.package) && known(seg.peer) && typeof seg.metric === 'string' && METRICS.includes(seg.metric)) {
      out.push({ t: 'compare', package: seg.package, peer: seg.peer, metric: seg.metric as 'window_total' | 'last30_total' | 'change_pct' | 'peak_value' })
    } else {
      return null
    }
  }
  const shown = tidy(out, target)
  return shown.length > 0 ? shown : null
}
