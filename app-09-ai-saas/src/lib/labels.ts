import type { Judged } from '../../shared/claims'
import { formatCount, formatDate } from '../../shared/format'
import type { PackageFacts, Rows, RunWindow, Segment, UnusualRow, Verdict } from '../../shared/types'
import type { PkgOutcome } from './useRun'

export interface PackageResult {
  name: string
  outcome: PkgOutcome
}
export interface Shown {
  name: string
  judged: Judged[]
}
/** A position in the shown paragraphs, as `figureNumbers` returns it. */
export interface Figure {
  paragraph: number
  segment: number
}
export interface LabelContext {
  window: RunWindow
  facts: PackageFacts[]
}

/** The paragraphs that arrived, in package order. A figure's `paragraph` index counts these. */
export function shownList(packages: PackageResult[]): Shown[] {
  return packages.flatMap(p => (p.outcome.status === 'ok' ? [{ name: p.name, judged: p.outcome.judged }] : []))
}

/** "past month", "past three months" or "past year", from the window's own name. */
export const periodWords = (window: RunWindow): string => window.name.slice('the '.length)

/** "a, b and c". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const OFFSET_WORDS = ['the same day', 'one day before', 'two days before']
export function releaseWords(release: UnusualRow['release']): string {
  if (release === 'none') return 'no release near'
  if (release === 'unavailable') return 'release history unavailable'
  return `release ${OFFSET_WORDS[release]}`
}

const unusualRow = (seg: Extract<Segment, { t: 'claim' }>, ctx: LabelContext): UnusualRow | undefined =>
  ctx.facts.find(f => f.name === seg.package)?.unusual.find(u => u.day === (seg.day || seg.value))

/** The words that follow a claim mark. They hold no digit of their own: names, periods and releases are in words. */
export function labelFor(seg: Segment, ctx: LabelContext): string {
  if (seg.t !== 'claim') return ''
  const who = seg.package
  switch (seg.kind) {
    case 'window_total':
      return `${who} · total${seg.span === 'last30' ? ', past month' : seg.span === 'window' ? `, ${periodWords(ctx.window)}` : ''}`
    case 'peak_value':
      return `${who} · downloads on busiest day`
    case 'peak_day':
      return `${who} · busiest day`
    case 'change_pct':
      return `${who} · change in average per day with downloads, past month vs the month before, days without downloads left out`
    case 'unusual_day': {
      const row = unusualRow(seg, ctx)
      return `${who} · unusual day${row ? ` · ${releaseWords(row.release)}` : ''}`
    }
    case 'day':
      return `${who} · date in window`
    case 'day_value':
      return `${who} · downloads that day`
  }
}

/**
 * What to render between two neighbouring segments when the model left nothing: a compare is a whole clause written by
 * code with no closing stop, so it is set apart from what touches it. Never touches a text segment's own bytes.
 */
export function separatorBetween(a: Judged, b: Judged): string {
  if (a.seg.t !== 'compare' && b.seg.t !== 'compare') return ''
  // A claim's visible end is its label, and a compare's is its last word: neither is a space.
  const end = a.seg.t === 'text' ? a.seg.s.slice(-1) : 'x'
  const start = b.seg.t === 'text' ? b.seg.s.slice(0, 1) : 'x'
  if (end === '' || start === '' || /\s/.test(end) || /\s/.test(start) || /[.,;:!?)]/.test(start)) return ''
  if (a.seg.t === 'compare') return '. '
  return /[.!?:]/.test(end) ? ' ' : '. '
}

/** The hover text of a mark: the npm value of a wrong figure, or the release version of an unusual day. Digits live here only. */
export function titleFor(j: Judged, ctx: LabelContext): string | undefined {
  if (j.verdict === 'wrong') return j.npmValue !== undefined ? `npm: ${j.npmValue}` : j.reason ? `Wrong: ${j.reason}` : 'Differs from npm'
  if (j.seg.t === 'claim' && j.seg.kind === 'unusual_day') {
    const version = unusualRow(j.seg, ctx)?.version
    return version ? `Release ${version}` : undefined
  }
  if (j.verdict === 'unchecked') return 'The model did not declare this as a figure, so it was not checked'
  return undefined
}

export interface Summary {
  checked: number
  wrong: number
  unchecked: number
  dates: number
  comparisons: number
}

/** Counts over the shown paragraphs. A comparison is counted under its verdict and again under comparisons. */
export function summarize(shown: Shown[]): Summary {
  const s: Summary = { checked: 0, wrong: 0, unchecked: 0, dates: 0, comparisons: 0 }
  for (const { judged } of shown) {
    for (const j of judged) {
      if (j.seg.t === 'text') {
        s.unchecked += j.runs?.length ?? 0
        continue
      }
      if (j.seg.t === 'compare') s.comparisons += 1
      if (j.verdict === 'checked') s.checked += 1
      else if (j.verdict === 'wrong') s.wrong += 1
      else if (j.verdict === 'unchecked') s.unchecked += 1
      else s.dates += 1
    }
  }
  return s
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
export function summaryText(s: Summary): string {
  return `${s.checked} checked, ${s.wrong} wrong, ${s.unchecked} unchecked, ${plural(s.dates, 'date', 'dates')}, ${plural(s.comparisons, 'comparison', 'comparisons')}`
}

export interface CheckRow {
  key: string
  number: number | null
  text: string
  kind: string
  pkg: string
  where: string
  modelValue: string
  npmValue: string
  howTo: string
  verdict: Verdict
}

const METRIC_WORDS = {
  window_total: 'totals for the window',
  last30_total: 'totals for the past month',
  change_pct: 'changes in average per day with downloads',
  peak_value: 'busiest-day values',
} as const

function growthText(pkg: string, ctx: LabelContext, rows: Rows | undefined): string {
  const g = ctx.facts.find(f => f.name === pkg)?.aggregates.growth
  if (!g || !g.computable) return 'Not computable: one of the two periods has no days with downloads.'
  const inRange = (day: string, [from, to]: [string, string]) => day >= from && day <= to
  const excluded = Object.entries(rows ?? {})
    .filter(([day, v]) => v === 0 && (inRange(day, ctx.window.past) || inRange(day, ctx.window.before)))
    .map(([day]) => day)
    .sort()
  return (
    `Average per day with downloads: ${formatCount(g.S1)}/${g.n1} for ${ctx.window.past[0]} to ${ctx.window.past[1]}, ` +
    `against ${formatCount(g.S0)}/${g.n0} for ${ctx.window.before[0]} to ${ctx.window.before[1]}. ` +
    `Days without downloads left out: ${excluded.length === 0 ? 'none' : excluded.join(', ')}.`
  )
}

function howToCheck(seg: Segment, ctx: LabelContext, rows: Rows | undefined): string {
  const { window } = ctx
  if (seg.t === 'text') return ''
  if (seg.t === 'compare') return `Work out each package's ${METRIC_WORDS[seg.metric]} and compare ${seg.package} with ${seg.peer}.`
  switch (seg.kind) {
    case 'window_total':
      return seg.span === 'last30'
        ? `Add the daily downloads from ${window.past[0]} to ${window.past[1]}.`
        : `Add the daily downloads from ${window.start} to ${window.L}.`
    case 'peak_value':
      return `The largest daily value from ${window.start} to ${window.L}.`
    case 'peak_day':
      return `The day of the largest daily value from ${window.start} to ${window.L}.`
    case 'day_value':
      return `Read the downloads for ${seg.day} in the npm range response.`
    case 'change_pct':
      return growthText(seg.package, ctx, rows)
    case 'unusual_day':
      return 'Look the day up in the unusual days table.'
    case 'day':
      return 'Any date inside the window; it is not checked as a figure.'
  }
}

/**
 * The npm value of a claim: npm's own figure when there is one. A wrong claim with none (a no-data day, a possible gap,
 * out of window, value form, no basis, a day not in the unusual set) shows the reason, never the model's number. A
 * checked claim with none shows its own value, which npm confirmed.
 */
function npmCell(j: Judged, modelValue: string): string {
  if (j.verdict === 'wrong') return j.npmValue ?? j.reason ?? ''
  return j.verdict === 'checked' ? (j.npmValue ?? modelValue) : ''
}

/** One row of the figure-check table per claim, plus one per undeclared number the model wrote in its text. */
export function checkRows(shown: Shown[], figures: Figure[], ctx: LabelContext, rowsByName: Record<string, Rows>): CheckRow[] {
  const numberAt = new Map(figures.map((f, i) => [`${f.paragraph}:${f.segment}`, i + 1]))
  const out: CheckRow[] = []
  shown.forEach(({ name, judged }, p) => {
    judged.forEach((j, s) => {
      if (j.seg.t === 'text') {
        for (const [r, run] of (j.runs ?? []).entries()) {
          out.push({
            key: `${p}:${s}:${r}`,
            number: null,
            text: j.seg.s.slice(run.start, run.end),
            kind: 'undeclared number',
            pkg: name,
            where: '',
            modelValue: j.seg.s.slice(run.start, run.end),
            npmValue: '',
            howTo: 'The model wrote this number in its text without declaring it as a figure, so it was not checked.',
            verdict: 'unchecked',
          })
        }
        return
      }
      const seg = j.seg
      const compare = seg.t === 'compare'
      // Code fills a compare's relation and a growth's value (GA.6), so the table says so instead of showing them as the model's.
      const modelValue = compare || seg.kind === 'change_pct' ? 'computed by code' : seg.value
      out.push({
        key: `${p}:${s}`,
        number: numberAt.get(`${p}:${s}`) ?? null,
        text: j.rendered,
        kind: compare ? 'compare' : seg.kind,
        pkg: seg.package,
        where: compare ? seg.metric : seg.day || seg.span,
        modelValue,
        npmValue: npmCell(j, modelValue),
        howTo: howToCheck(seg, ctx, rowsByName[seg.package]),
        verdict: j.verdict,
      })
    })
  })
  return out
}

export { formatDate }
