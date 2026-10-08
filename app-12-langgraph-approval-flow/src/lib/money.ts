const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** Whole cents for a dollar amount, so sums and comparisons never drift on floating point. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100)
}

/** A dollar amount for display, for example 129 becomes "$129.00". */
export function formatUsd(dollars: number): string {
  return usd.format(dollars)
}
