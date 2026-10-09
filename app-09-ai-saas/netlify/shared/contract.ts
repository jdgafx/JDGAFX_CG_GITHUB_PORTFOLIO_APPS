/**
 * The contract between the dashboard and the insights function: the summary the browser sends, and the
 * npm package-name rule both sides apply. Shared so the two cannot drift apart.
 */

export const MAX_PACKAGES = 5

/** Longest package name npm accepts, scope included. */
const MAX_NAME_LENGTH = 214

/** One name part (the scope or the package): lowercase, URL-safe, and not starting with a dot or underscore. */
const NAME_PART = /^[a-z0-9-][a-z0-9._-]*$/

/**
 * True when `name` is a valid npm package name under the rules for new packages: at most 214 characters,
 * lowercase, URL-safe, no leading dot or underscore, and an optional `@scope/` prefix with the same rules.
 */
export function isValidPackageName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return false
  if (!name.startsWith('@')) return NAME_PART.test(name)
  const parts = name.slice(1).split('/')
  return parts.length === 2 && parts.every((part) => NAME_PART.test(part))
}

/** Days on each side of the trend comparison: the latest half of the window against the half before it. */
export function halfWindow(windowDays: number): number {
  return Math.floor(windowDays / 2)
}

/** The figures for one package. Every number is rounded the way the dashboard shows it. */
export interface PackageFigures {
  name: string
  /** Downloads over the days npm reported. */
  total: number
  avgPerDay: number
  /** Latest half against the half before, per reported day. Null when the earlier half has no downloads. */
  changePct: number | null
  /** Weekend downloads per day as a percentage of weekday downloads per day. Null when it cannot be worked out. */
  weekendPct: number | null
  /** Share of the selection's downloads. */
  sharePct: number
}

/** What Generate insights sends: the window and one row of figures per package. No daily series. */
export interface Summary {
  startDate: string
  endDate: string
  /** Calendar days from startDate to endDate, both included. */
  windowDays: number
  /** Days in the window that npm reported data for. */
  observedDays: number
  packages: PackageFigures[]
}
