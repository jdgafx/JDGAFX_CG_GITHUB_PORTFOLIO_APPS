import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Day, Release, Rows, WindowDays } from '../../shared/types'

const here = fileURLToPath(new URL('./', import.meta.url))

export const DATES = ['2026-10-11', '2026-10-12'] as const
export type FixtureDate = (typeof DATES)[number]

export interface ExpectedPackage {
  windowTotal: string
  last30Total: string
  peakDay: Day
  peakValue: number
  S1: string
  n1: number
  S0: string
  n0: number
  computable: boolean
  A1: string | null
  A0: string | null
  change: string | null
  change1: string | null
  change2: string | null
  notAssessed: Day[]
  possibleGaps: Day[]
  unusual: Array<{ day: Day; value: number; median: number; kind: 'spike' | 'drop'; release: 0 | 1 | 2 | 'none'; version?: string }>
  top6: Day[]
}
export interface ExpectedScenario {
  runDate: Day
  L: Day
  days: WindowDays
  start: Day
  name: string
  noData: Day[]
  noDataInWindow: Day[]
  past: [Day, Day]
  before: [Day, Day]
  packages: Record<string, ExpectedPackage>
}
export interface Scenario {
  key: string
  date: FixtureDate
  names: string[]
  days: WindowDays
  rows: Record<string, Rows>
  releases: Record<string, Release[]>
  expected: ExpectedScenario
}

const read = (rel: string): string => readFileSync(here + rel, 'utf8')
const json = <T>(rel: string): T => JSON.parse(read(rel)) as T

export const fname = (name: string): string => name.replace('@', '').replace('/', '-')

const config = json<{ scenarios: Record<string, { names: string[]; days: WindowDays }> }>('scenarios.json')
export const SCENARIO_KEYS = Object.keys(config.scenarios)

export function loadScenario(date: FixtureDate, key: string): Scenario {
  const sc = config.scenarios[key]
  if (!sc) throw new Error(`unknown scenario ${key}`)
  const rows: Record<string, Rows> = {}
  const releases: Record<string, Release[]> = {}
  for (const n of sc.names) {
    const body = json<{ downloads: Array<{ day: Day; downloads: number }> }>(`${date}/npm-${fname(n)}.json`)
    rows[n] = Object.fromEntries(body.downloads.map((r) => [r.day, r.downloads]))
    releases[n] = json<{ releases: Release[] }>(`${date}/releases-${fname(n)}.json`).releases
  }
  const expected = json<Record<string, ExpectedScenario>>(`${date}/expected.json`)[key]
  if (!expected) throw new Error(`no expected for ${key}`)
  return { key, date, names: sc.names, days: sc.days, rows, releases, expected }
}

export function loadGolden(file: string): string {
  return read(`golden/${file}`)
}
export function loadGoldenJson<T>(file: string): T {
  return json<T>(`golden/${file}`)
}

/** n consecutive days starting at `start`, values from `values` (cycled when shorter). */
export function series(start: Day, n: number, values: number[] | ((i: number, day: Day) => number)): Rows {
  const out: Rows = {}
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10)
    out[day] = typeof values === 'function' ? values(i, day) : (values[i % values.length] as number)
  }
  return out
}
