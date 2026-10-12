// Independent recompute of every checkable figure from the raw rows. It derives the no-data days,
// L, the window, the medians, the sums and the growth with its own code and imports nothing but the
// shared types (spec section 2), so a slip in window.ts, aggregates.ts or unusual.ts cannot hide
// here. All arithmetic is exact: BigInt for sums and the rational change, integers for medians.
import type { Day, Rows, Segment, WindowDays } from './types'

export interface PackageRecomputed {
  windowTotal: bigint
  last30Total: bigint
  peakDay: Day
  peakValue: bigint
  S1: bigint
  n1: number
  S0: bigint
  n0: number
  computable: boolean
  /** exact change in percent, (A1/A0 - 1) x 100, as changeNum / changeDen (changeDen > 0) */
  changeNum: bigint
  changeDen: bigint
  /** every unusual day; median2 is twice the median */
  unusual: Map<Day, { kind: 'spike' | 'drop'; median2: number }>
  possibleGaps: Set<Day>
  notAssessed: Day[]
  values: Rows
}
export interface Recomputed {
  runDate: Day
  L: Day
  start: Day
  days: WindowDays
  noData: Set<Day>
  packages: Record<string, PackageRecomputed>
}
export interface Check {
  verdict: 'checked' | 'wrong' | 'neutral'
  /** the npm value in plain form: digits, an ISO day, `+34.1`, or higher / lower / equal for a compare */
  npm?: string
  reason?: string
}

const MS = 86_400_000
const num = (day: Day): number => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / MS
const iso = (n: number): Day => new Date(n * MS).toISOString().slice(0, 10)
const COUNT = /^[0-9]+$/
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/
const PCT = /^([+-])([0-9]+)[.]([0-9]{2})$/
const realDate = (s: string): boolean => DATE.test(s) && iso(num(s)) === s

export function recompute(rowsByName: Record<string, Rows>, runDate: Day, days: WindowDays): Recomputed {
  const names = Object.keys(rowsByName)
  const val = (n: string, d: number): number => rowsByName[n]?.[iso(d)] ?? 0
  const run = num(runDate)
  const seen = new Set<number>()
  for (const n of names) for (const k of Object.keys(rowsByName[n] ?? {})) if (num(k) < run) seen.add(num(k))
  const before = [...seen].sort((a, b) => a - b)
  const solo = names.length === 1
  const noDataNums = new Set(solo ? [] : before.filter((d) => names.every((n) => val(n, d) === 0)))
  const usable = before.filter((d) => (solo ? val(names[0] as string, d) > 0 : !noDataNums.has(d)))
  const last = usable[usable.length - 1]
  if (last === undefined) throw new Error('npm reports no downloads for these packages')
  if (last < run - 7) throw new Error('npm has not published recent days yet')
  const first = last - days + 1
  const out: Recomputed = {
    runDate,
    L: iso(last),
    start: iso(first),
    days,
    noData: new Set([...noDataNums].map(iso)),
    packages: {},
  }
  const total = (n: string, a: number, b: number): bigint => {
    let t = 0n
    for (let d = a; d <= b; d++) t += BigInt(val(n, d))
    return t
  }
  const basis = (n: string, a: number, b: number): { S: bigint; c: number } => {
    let S = 0n
    let c = 0
    for (let d = a; d <= b; d++)
      if (val(n, d) > 0) {
        S += BigInt(val(n, d))
        c++
      }
    return { S, c }
  }
  for (const n of names) {
    let peak = first
    for (let d = first; d <= last; d++) if (val(n, d) > val(n, peak)) peak = d
    const g1 = basis(n, last - 29, last)
    const g0 = basis(n, last - 59, last - 30)
    const computable = g1.c > 0 && g0.c > 0 && g0.S > 0n
    const unusual = new Map<Day, { kind: 'spike' | 'drop'; median2: number }>()
    const possibleGaps = new Set<Day>()
    const notAssessed: Day[] = []
    for (let d = first; d <= last; d++) {
      if (noDataNums.has(d)) continue
      const base: number[] = []
      for (let k = 1; k <= 8; k++) {
        const y = d - 7 * k
        if (!noDataNums.has(y) && val(n, y) > 0) base.push(val(n, y))
      }
      base.sort((a, b) => a - b)
      const h = Math.floor(base.length / 2)
      const median2 = base.length % 2 === 1 ? 2 * (base[h] as number) : (base[h - 1] as number) + (base[h] as number)
      if (base.length < 4 || median2 < 200) {
        notAssessed.push(iso(d))
        continue
      }
      const v = val(n, d)
      if (v === 0) {
        if (solo || names.some((o) => o !== n && val(o, d) > 0)) possibleGaps.add(iso(d))
        continue
      }
      // spike: 4v >= 6 x median = 3 x median2; drop: 4v <= 2 x median = median2
      if (4 * v >= 3 * median2) unusual.set(iso(d), { kind: 'spike', median2 })
      else if (4 * v <= median2) unusual.set(iso(d), { kind: 'drop', median2 })
    }
    out.packages[n] = {
      windowTotal: total(n, first, last),
      last30Total: total(n, last - 29, last),
      peakDay: iso(peak),
      peakValue: BigInt(val(n, peak)),
      S1: g1.S,
      n1: g1.c,
      S0: g0.S,
      n0: g0.c,
      computable,
      changeNum: computable ? 100n * (g1.S * BigInt(g0.c) - BigInt(g1.c) * g0.S) : 0n,
      changeDen: computable ? BigInt(g1.c) * g0.S : 1n,
      unusual,
      possibleGaps,
      notAssessed,
      values: rowsByName[n] ?? {},
    }
  }
  return out
}

const wrong = (reason: string, npm?: string): Check => (npm === undefined ? { verdict: 'wrong', reason } : { verdict: 'wrong', reason, npm })
const abs = (x: bigint): bigint => (x < 0n ? -x : x)

/** The two-decimal change value as tenths, rounded half away from zero on the digits. */
function shownTenths(value: string): bigint | null {
  const m = PCT.exec(value)
  if (!m) return null
  const t = (BigInt(m[2] as string) * 100n + BigInt(m[3] as string) + 5n) / 10n
  return m[1] === '-' ? -t : t
}
const tenthsText = (t: bigint): string => `${t < 0n ? '-' : '+'}${abs(t) / 10n}.${abs(t) % 10n}`

function checkChange(seg: Extract<Segment, { t: 'claim' }>, p: PackageRecomputed): Check {
  if (!p.computable) return wrong('no basis')
  const shown = shownTenths(seg.value)
  if (shown === null) return wrong('value form')
  // exact change in tenths = 10 x changeNum / changeDen, rounded half away from zero
  const scaled = 10n * abs(p.changeNum)
  const q = (2n * scaled + p.changeDen) / (2n * p.changeDen)
  const tie = (2n * scaled + p.changeDen) % (2n * p.changeDen) === 0n
  const sign = p.changeNum < 0n ? -1n : 1n
  const exact = sign * q
  const ok = shown === exact || (tie && shown === sign * (q - 1n))
  return ok ? { verdict: 'checked', npm: tenthsText(exact) } : wrong('differs', tenthsText(exact))
}

function metricOf(metric: string, p: PackageRecomputed): { n: bigint; d: bigint } | null {
  if (metric === 'window_total') return { n: p.windowTotal, d: 1n }
  if (metric === 'last30_total') return { n: p.last30Total, d: 1n }
  if (metric === 'peak_value') return { n: p.peakValue, d: 1n }
  if (metric === 'change_pct') return p.computable ? { n: p.changeNum, d: p.changeDen } : null
  return null
}

function checkCompare(seg: Extract<Segment, { t: 'compare' }>, rc: Recomputed): Check {
  const a = rc.packages[seg.package]
  const b = rc.packages[seg.peer]
  if (!a || !b) return wrong('unknown package')
  if (seg.package === seg.peer) return wrong('same package')
  const x = metricOf(seg.metric, a)
  const y = metricOf(seg.metric, b)
  if (!x || !y) return wrong('no basis', 'no basis')
  const diff = x.n * y.d - y.n * x.d
  if (diff === 0n) return wrong('tie', 'equal')
  const truth = diff > 0n ? 'higher' : 'lower'
  return seg.relation === truth ? { verdict: 'checked', npm: truth } : wrong('differs', truth)
}

/** Judge one segment against the recomputed figures. Text segments are neutral here. */
export function checkSegment(seg: Segment, rc: Recomputed): Check {
  if (seg.t === 'text') return { verdict: 'neutral' }
  if (seg.t === 'compare') return checkCompare(seg, rc)
  const p = rc.packages[seg.package]
  if (!p) return wrong('unknown package')
  const inWindow = (d: Day): boolean => d >= rc.start && d <= rc.L
  const countOk = COUNT.test(seg.value)
  switch (seg.kind) {
    case 'day_value': {
      if (!countOk || !realDate(seg.day)) return wrong('value form')
      if (!inWindow(seg.day)) return wrong('outside window')
      if (rc.noData.has(seg.day)) return wrong('no-data day')
      if (p.possibleGaps.has(seg.day)) return wrong('possible gap')
      const actual = String(p.values[seg.day] ?? 0)
      return BigInt(seg.value) === BigInt(actual) ? { verdict: 'checked', npm: actual } : wrong('differs', actual)
    }
    case 'window_total':
    case 'peak_value': {
      if (!countOk) return wrong('value form')
      const total = seg.kind === 'peak_value' ? p.peakValue : seg.span === 'last30' ? p.last30Total : p.windowTotal
      const npm = String(total)
      if (seg.kind === 'window_total' && seg.span === 'none') return wrong('span', npm)
      if (seg.kind === 'peak_value' && seg.span === 'last30') return wrong('span', npm)
      return BigInt(seg.value) === total ? { verdict: 'checked', npm } : wrong('differs', npm)
    }
    case 'peak_day':
    case 'unusual_day':
    case 'day': {
      if (!realDate(seg.value)) return wrong('value form')
      if (seg.day !== '' && seg.day !== seg.value) return wrong('day differs from value')
      if (seg.kind === 'peak_day') {
        if (seg.span === 'last30') return wrong('span', p.peakDay)
        return seg.value === p.peakDay ? { verdict: 'checked', npm: p.peakDay } : wrong('differs', p.peakDay)
      }
      if (seg.kind === 'unusual_day') return p.unusual.has(seg.value) ? { verdict: 'checked' } : wrong('not in the unusual set')
      return inWindow(seg.value) ? { verdict: 'neutral' } : wrong('outside window')
    }
    case 'change_pct':
      return checkChange(seg, p)
    default:
      return wrong('unknown kind')
  }
}
