const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const FULL = new Intl.NumberFormat('en-US')
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const LONG_DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })

/** 1,234,567 as "1.2M", for axes and tight spaces. */
export const compact = (n: number): string => COMPACT.format(n)

/** 1234567 as "1,234,567". */
export const full = (n: number): string => FULL.format(n)

/** "2026-09-08" as "Sep 8". */
export const shortDate = (iso: string): string => SHORT_DATE.format(new Date(`${iso}T00:00:00Z`))

/** "2026-09-08" as "Sep 8, 2026". */
export const longDate = (iso: string): string => LONG_DATE.format(new Date(`${iso}T00:00:00Z`))

/** A signed percentage with its sign always shown: "+3.2%", "-4.1%", "0%". */
export const signedPercent = (value: number): string => `${value > 0 ? '+' : ''}${value}%`

/** The CSS colour for the package at `index` in the selection. app.css maps --hub-s1..5 onto the shared chart series tokens. */
export const seriesColor = (index: number): string => `var(--hub-s${(index % 5) + 1})`

/** Milliseconds as "1,234 ms". */
export const milliseconds = (n: number): string => `${Math.round(n).toLocaleString('en-US')} ms`

/** Dollars from the provider, with more places for a fraction of a cent. */
export const usd = (n: number): string => `$${n.toFixed(n < 0.01 ? 6 : 4)}`

/** "anthropic/claude-haiku-5.5" as "claude-haiku-5.5", for a chip. The full id stays in the title. */
export const shortModel = (id: string): string => id.split('/').pop() ?? id
