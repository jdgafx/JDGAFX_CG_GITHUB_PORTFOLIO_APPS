import { addDays } from './format'
import type { Day, Release, ReleaseState, Rows, RunWindow, UnusualRow } from './types'

export interface UnusualResult {
  unusual: UnusualRow[]
  possibleGaps: Day[]
  notAssessed: Day[]
}

const MIN_VALUES = 4
const MIN_BASE_X2 = 200 // base < 100, in doubled units

const versionParts = (v: string): number[] => v.split('.').map((p) => Number.parseInt(p, 10) || 0)
function compareVersions(a: string, b: string): number {
  const pa = versionParts(a)
  const pb = versionParts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** The nearest stable release on d-2..d; several on that day show the highest version. */
function releaseNear(day: Day, releases: Release[], state: ReleaseState): Pick<UnusualRow, 'release' | 'version'> {
  if (state !== 'ok') return { release: 'unavailable' }
  for (const offset of [0, 1, 2] as const) {
    const at = addDays(day, -offset)
    const versions = releases.filter((r) => r.day === at).map((r) => r.version)
    if (versions.length > 0) return { release: offset, version: versions.sort(compareVersions).pop() as string }
  }
  return { release: 'none' }
}

/**
 * Unusual days for one package over the window. For each window day that is not a no-data day, the
 * base is the median of the non-zero values on the same weekday at d-7 .. d-56 (no-data days
 * skipped). Not assessed with fewer than 4 values or a base under 100. A zero day that is assessed
 * and where another selected package is above 0 (or only one is selected) is a possible npm gap,
 * checked before spike or drop. Spike: 4v >= 6 x median. Drop: 4v <= 2 x median. Integer maths on
 * the doubled median keeps it exact.
 */
export function computeUnusual(
  name: string,
  rowsByName: Record<string, Rows>,
  window: RunWindow,
  releases: Release[],
  state: ReleaseState,
): UnusualResult {
  const rows = rowsByName[name] ?? {}
  const others = Object.keys(rowsByName).filter((n) => n !== name)
  const noData = new Set(window.noData)
  const result: UnusualResult = { unusual: [], possibleGaps: [], notAssessed: [] }
  for (let day = window.start; day <= window.L; day = addDays(day, 1)) {
    if (noData.has(day)) continue
    const values: number[] = []
    for (let k = 1; k <= 8; k++) {
      const back = addDays(day, -7 * k)
      const v = rows[back]
      if (v !== undefined && v > 0 && !noData.has(back)) values.push(v)
    }
    values.sort((a, b) => a - b)
    const mid = values.length >> 1
    const median2 = values.length % 2 ? 2 * (values[mid] as number) : (values[mid - 1] as number) + (values[mid] as number)
    if (values.length < MIN_VALUES || median2 < MIN_BASE_X2) {
      result.notAssessed.push(day)
      continue
    }
    const v = rows[day] ?? 0
    if (v === 0) {
      if (others.length === 0 || others.some((o) => (rowsByName[o]?.[day] ?? 0) > 0)) result.possibleGaps.push(day)
      continue
    }
    const kind = 4 * v >= 3 * median2 ? 'spike' : 4 * v <= median2 ? 'drop' : null
    if (kind) result.unusual.push({ day, value: v, median: median2 / 2, kind, ...releaseNear(day, releases, state) })
  }
  return result
}

const strength = (u: UnusualRow): number => (u.kind === 'spike' ? u.value / u.median : u.median / Math.max(u.value, 1))

/** The n strongest unusual days (spike: value over median; drop: median over value), in day order. */
export function topUnusual(rows: UnusualRow[], n = 6): UnusualRow[] {
  return [...rows]
    .sort((a, b) => strength(b) - strength(a))
    .slice(0, n)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}
