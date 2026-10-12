import type { Day } from './types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86_400_000

const epochDay = (day: Day): number => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d) / DAY_MS
}

/** A real calendar date written YYYY-MM-DD. */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  return addDays(s, 0) === s
}

export function addDays(day: Day, n: number): Day {
  return new Date((epochDay(day) + n) * DAY_MS).toISOString().slice(0, 10)
}

/** a minus b, in days. */
export function dayDiff(a: Day, b: Day): number {
  return epochDay(a) - epochDay(b)
}

/** A whole count with thousands commas; exact for any size. */
export function formatCount(v: bigint | number | string): string {
  const digits = BigInt(v).toString()
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** D Mon YYYY, no padding. */
export function formatDate(iso: Day): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/**
 * A change_pct value (code-filled `+34.10`, two decimals) shown to one decimal with its % sign,
 * rounded half away from zero on the digits. Null when the value is not in that form.
 */
export function formatPct(value: string): string | null {
  const m = /^([+-])(\d+)\.(\d{2})$/.exec(value)
  if (!m) return null
  const hundredths = BigInt(m[2] as string) * 100n + BigInt(m[3] as string)
  const tenths = (hundredths + 5n) / 10n
  // A negative that rounds to zero is zero: no -0.0%.
  const sign = tenths === 0n ? '+' : m[1]
  return `${sign}${tenths / 10n}.${tenths % 10n}%`
}

/** num/den to `places` decimals, exact, half up (half away from zero when negative; a negative that rounds to zero has no sign). */
export function fixedDecimal(num: bigint, den: bigint, places: number): string {
  const scale = 10n ** BigInt(places)
  const a = num < 0n ? -num : num
  const q = (a * scale * 2n + den) / (2n * den)
  const sign = num < 0n && q !== 0n ? '-' : ''
  const frac = (q % scale).toString().padStart(places, '0')
  return `${sign}${q / scale}${places > 0 ? `.${frac}` : ''}`
}
