/** Calendar-date helpers on `YYYY-MM-DD` strings. Everything is UTC, so the result never depends on the viewer's time zone. */

const DAY_MS = 86_400_000

const toTime = (date: string): number => Date.parse(`${date}T00:00:00Z`)

/** Today's date in UTC, the day npm's counters are cut on. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  return new Date(toTime(date) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toTime(to) - toTime(from)) / DAY_MS)
}

/** 0 for Sunday through 6 for Saturday. */
export function weekdayOf(date: string): number {
  return new Date(toTime(date)).getUTCDay()
}

export function isWeekend(date: string): boolean {
  const day = weekdayOf(date)
  return day === 0 || day === 6
}
