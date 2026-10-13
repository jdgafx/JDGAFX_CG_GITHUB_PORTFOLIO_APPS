import { parseNumericCell } from './dataEngine'
import type { ParsedData } from '../types'

/** What the live earthquake rows show at a glance, counted from the rows themselves. No model is involved. */
export interface Glance {
  total: number
  /** One entry per UTC day from the first to the last day in the feed, a day with no quake counting zero. */
  days: { label: string; count: number }[]
  strongest: { mag: number; place: string } | null
  busiest: { label: string; count: number }
  /** The newest quake's time as the feed writes it (ISO, UTC). */
  latest: string
}

const DAY = /^(\d{4}-\d{2}-\d{2})T/
const MS_PER_DAY = 86_400_000

function nextDay(label: string): string {
  return new Date(Date.parse(`${label}T00:00:00Z`) + MS_PER_DAY).toISOString().slice(0, 10)
}

/** The glance for rows with a `time` and a `mag` column (the USGS feeds), or null for any other table or when no row has a time. */
export function glanceFor(data: ParsedData): Glance | null {
  if (!data.headers.includes('time') || !data.headers.includes('mag')) return null
  const counts = new Map<string, number>()
  let latest = ''
  let strongest: Glance['strongest'] = null
  let total = 0
  for (const row of data.rows) {
    const time = row.time ?? ''
    const day = DAY.exec(time)?.[1]
    if (!day) continue
    total += 1
    counts.set(day, (counts.get(day) ?? 0) + 1)
    if (time > latest) latest = time
    const mag = parseNumericCell(row.mag)
    if (mag !== null && (strongest === null || mag > strongest.mag)) strongest = { mag, place: row.place ?? '' }
  }
  if (total === 0) return null
  const labels = [...counts.keys()].sort()
  const first = labels[0] as string
  const last = labels[labels.length - 1] as string
  const days: Glance['days'] = []
  for (let label = first; label <= last && days.length < 400; label = nextDay(label)) days.push({ label, count: counts.get(label) ?? 0 })
  const busiest = days.reduce((best, day) => (day.count > best.count ? day : best), days[0] as { label: string; count: number })
  return { total, days, strongest, busiest, latest }
}
