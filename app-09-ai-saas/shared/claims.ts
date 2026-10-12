import { formatCount, formatDate, formatPct, isIsoDate } from './format'
import { checkSegment, recompute } from './recompute'
import type { Check } from './recompute'
import type { FigureKind, Rows, RunWindow, Segment, Verdict, WindowDays } from './types'

export type ClaimSeg = Extract<Segment, { t: 'claim' }>
export type CompareSeg = Extract<Segment, { t: 'compare' }>

/** One judged segment. `runs` (text only) are the undeclared digit runs, as [start, end) offsets. */
export interface Judged {
  seg: Segment
  verdict: Verdict
  rendered: string
  npmValue?: string
  reason?: string
  runs?: Array<{ start: number; end: number }>
}
export type ShapeResult = { ok: true } | { ok: false; reason: string }

export const NO_VALUE = '(no value)'
const MAX_TEXT = 1500
const MAX_CLAIMS = 12
const WINDOW_NAMES: Record<WindowDays, string> = { 30: 'the past month', 90: 'the past three months', 365: 'the past year' }
const COUNT_KINDS: FigureKind[] = ['day_value', 'window_total', 'peak_value']
const KINDS: FigureKind[] = ['day_value', 'window_total', 'peak_value', 'peak_day', 'change_pct', 'unusual_day', 'day']
const METRICS = ['window_total', 'last30_total', 'change_pct', 'peak_value']

/** The text a claim mark shows, built from its value only. A value in the wrong form shows (no value). */
export function renderClaim(seg: ClaimSeg): string {
  if (COUNT_KINDS.includes(seg.kind)) return /^[0-9]+$/.test(seg.value) ? formatCount(seg.value) : NO_VALUE
  if (seg.kind === 'change_pct') return formatPct(seg.value) ?? NO_VALUE
  return isIsoDate(seg.value) ? formatDate(seg.value) : NO_VALUE
}

/** A compare as one clause written by code, with no digits. `windowName` is the run's window name. */
export function renderCompare(seg: CompareSeg, windowName: string): string {
  const { package: p, peer: q, relation: rel } = seg
  switch (seg.metric) {
    case 'window_total':
      return `${p}'s total for ${windowName} is ${rel} than ${q}'s`
    case 'last30_total':
      return `${p}'s total for the past month is ${rel} than ${q}'s`
    case 'change_pct':
      return `${p} grew ${rel === 'higher' ? 'faster' : 'slower'} than ${q} over the past month`
    case 'peak_value':
      return `${p}'s busiest day in ${windowName} was ${rel} than ${q}'s`
  }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const strings = (o: Record<string, unknown>, keys: string[]): boolean => keys.every((k) => typeof o[k] === 'string')

/** Shape check of a decoded paragraph: well-formed segments, at most 1,500 text characters, at most 12 claims. */
export function validateShape(input: unknown): ShapeResult {
  const bad: ShapeResult = { ok: false, reason: 'bad shape' }
  if (!Array.isArray(input)) return bad
  let chars = 0
  let claims = 0
  for (const seg of input as unknown[]) {
    if (!isRecord(seg)) return bad
    if (seg['t'] === 'text') {
      if (typeof seg['s'] !== 'string') return bad
      chars += seg['s'].length
    } else if (seg['t'] === 'claim') {
      if (!strings(seg, ['kind', 'package', 'span', 'day', 'value'])) return bad
      if (!KINDS.includes(seg['kind'] as FigureKind) || !['window', 'last30', 'none'].includes(seg['span'] as string)) return bad
      claims++
    } else if (seg['t'] === 'compare') {
      if (!strings(seg, ['package', 'peer', 'metric', 'relation'])) return bad
      if (!METRICS.includes(seg['metric'] as string) || !['higher', 'lower'].includes(seg['relation'] as string)) return bad
      claims++
    } else return bad
  }
  if (chars > MAX_TEXT) return { ok: false, reason: 'the paragraph was too long' }
  if (claims > MAX_CLAIMS) return { ok: false, reason: 'the paragraph made too many claims' }
  return { ok: true }
}

/**
 * Digit runs (`\p{Nd}[\p{Nd},.]*`) in a text segment: a digit of any script (Arabic-Indic, fullwidth,
 * Devanagari and the rest), not only 0-9. A tokenizer of digit form with no vocabulary, and the
 * only pattern applied to model text. Digits inside a selected package's own name (d3) are exempt,
 * by position.
 */
function undeclaredNumerals(text: string, names: string[]): Array<{ start: number; end: number }> {
  const lower = text.toLowerCase()
  const spans: Array<[number, number]> = []
  for (const name of names) {
    const n = name.toLowerCase()
    for (let at = lower.indexOf(n); n !== '' && at !== -1; at = lower.indexOf(n, at + 1)) spans.push([at, at + n.length])
  }
  const runs: Array<{ start: number; end: number }> = []
  for (const m of text.matchAll(/\p{Nd}[\p{Nd},.]*/gu)) {
    const start = m.index
    const end = start + m[0].length
    const exempt = spans.some(([s, e]) => s <= start && start < e && /^[,.]*$/.test(text.slice(e, end)))
    if (!exempt) runs.push({ start, end })
  }
  return runs
}

function npmText(seg: Segment, c: Check, windowName: string): string | undefined {
  if (c.npm === undefined) return undefined
  if (seg.t === 'compare') {
    return c.npm === 'higher' || c.npm === 'lower' ? renderCompare({ ...seg, relation: c.npm }, windowName) : c.npm
  }
  if (seg.t === 'text') return undefined
  if (COUNT_KINDS.includes(seg.kind)) return formatCount(c.npm)
  if (seg.kind === 'change_pct') return `${c.npm}%`
  return isIsoDate(c.npm) ? formatDate(c.npm) : c.npm
}

/**
 * The verdict for each segment, from an independent recompute of the raw rows. Only `runDate` and
 * `days` are taken from `window`; the recompute derives L, the no-data days and the window itself.
 */
export function judge(segments: Segment[], rowsByName: Record<string, Rows>, window: RunWindow, days: WindowDays): Judged[] {
  const rc = recompute(rowsByName, window.runDate, days)
  const names = Object.keys(rowsByName)
  const windowName = WINDOW_NAMES[days]
  return segments.map((seg): Judged => {
    if (seg.t === 'text') {
      const runs = undeclaredNumerals(seg.s, names)
      return runs.length > 0 ? { seg, verdict: 'unchecked', rendered: seg.s, runs } : { seg, verdict: 'neutral', rendered: seg.s }
    }
    const c = checkSegment(seg, rc)
    const out: Judged = { seg, verdict: c.verdict, rendered: seg.t === 'compare' ? renderCompare(seg, windowName) : renderClaim(seg) }
    const npm = npmText(seg, c, windowName)
    if (npm !== undefined) out.npmValue = npm
    if (c.reason !== undefined) out.reason = c.reason
    return out
  })
}

/**
 * Figures 1, 2, 3 ... in reading order: the claim marks whose rendered text contains a number,
 * dates excluded. Compares and (no value) marks are skipped; a wrong figure still counts, because
 * its mark shows the model's number.
 */
export function figureNumbers(paragraphs: Segment[][]): Array<{ paragraph: number; segment: number }> {
  const out: Array<{ paragraph: number; segment: number }> = []
  paragraphs.forEach((paragraph, p) =>
    paragraph.forEach((seg, i) => {
      if (seg.t !== 'claim') return
      const figure = COUNT_KINDS.includes(seg.kind) || seg.kind === 'change_pct'
      if (figure && renderClaim(seg) !== NO_VALUE) out.push({ paragraph: p, segment: i })
    }),
  )
  return out
}
