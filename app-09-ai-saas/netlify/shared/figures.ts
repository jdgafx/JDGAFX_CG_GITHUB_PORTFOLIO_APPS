/** Reading the figures written in an explanation: percentages, counts, multiples, and how exactly each is written. */

export type Sign = 1 | -1 | 0

import { clauseSpans } from './boundaries'

/** The text from the start of the clause the character at `index` is in, to `index`. */
function clauseBefore(text: string, index: number): string {
  const spans = clauseSpans(text.slice(0, index))
  return text.slice(spans[spans.length - 1].start, index)
}

/** Rounds to a number of decimal places, halves up. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** How far weekends sit below (or above) weekdays, in percent of the weekday level. */
export function weekendGap(weekendPct: number): number {
  return roundTo(Math.abs(100 - weekendPct), 1)
}

/**
 * A figure the check can match: a percentage, a count with a scale word (1.2 billion, 41k), a count
 * with thousands separators (35,968,597), or a multiple (4.3 times, 11x). Plain small numbers and the day window are not figures to check.
 */
const FIGURE =
  /(?<![\d.,])(?:(\d[\d,]*(?:\.\d+)?)\s?%(?![A-Za-z])|(\d[\d,]*(?:\.\d+)?)\s?(billion|million|thousand|bn|[kKMB])(?![A-Za-z])|(\d{1,3}(?:,\d{3})+)(?!\d|,\d)|(\d+(?:\.\d+)?)\s?(?:times|x)(?![A-Za-z]))/g

const SCALES: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9 }

/** Words that say a trend rose, and words that say it fell. Only these set the direction of a figure. */
const RISE_WORDS = new Set(['up', 'rose', 'rise', 'rises', 'rising', 'grew', 'grow', 'grows', 'growing', 'increased', 'increase', 'higher', 'climbed', 'jumped', 'gained'])
const FALL_WORDS = new Set(['down', 'fell', 'fall', 'falls', 'falling', 'dropped', 'drop', 'decreased', 'decrease', 'declined', 'decline', 'lower', 'reduced', 'lost', 'shrank'])

/** How many words before a figure, in the same sentence, are read for its direction. */
const DIRECTION_WORDS = 4

/**
 * The direction a figure is written with. A minus or plus attached to the figure wins. Otherwise the
 * nearest rise or fall word among the few words before it, within the same sentence, gives it. Zero
 * means the text gives no direction.
 */
export function signOf(text: string, start: number): Sign {
  const before = text.charAt(start - 1)
  const beforeThat = text.charAt(start - 2)
  if (/[-−–+]/.test(before) && !/[A-Za-z0-9]/.test(beforeThat)) return before === '+' ? 1 : -1
  const sentence = clauseBefore(text, start)
  const words = sentence.trim().split(/\s+/).slice(-DIRECTION_WORDS).reverse()
  for (const word of words) {
    const bare = word.toLowerCase().replace(/[^a-z]/g, '')
    if (RISE_WORDS.has(bare)) return 1
    if (FALL_WORDS.has(bare)) return -1
  }
  return 0
}

export type Unit = '%' | 'count' | 'times'

export interface Range {
  low: number
  high: number
  /** Decimals of the more precise bound. */
  decimals: number
}

export interface Quoted {
  unit: Unit
  /** For "60 to 63%", "60-63%" or "between 60% and 63%": the bounds. The figure is then not a single value. */
  range?: Range
  value: number
  decimals: number
  /** 1 for a figure written out in full, 1e6 for "million", and so on. */
  scale: number
  sign: Sign
  /** True when a hedge such as "about" or "roughly" stands a few words before the figure in its sentence. */
  hedged?: boolean
  /** "more than 10 times" is a lower bound, "less than 10 times" an upper one: true when the real value is on that side of it. */
  bound?: 'lower' | 'upper'
  /**
   * "nearly 100,000" is a little under, "just over 98,000" a little over. The real value matches on that side only, within
   * about 5% of the figure or one unit of its written decimals, whichever is wider.
   */
  approx?: 'below' | 'above'
  /** "up to 50%": not a value, never matched. */
  vague?: boolean
}

/** A checkable figure written in the text: where it starts, how it is written and what it says. Its sign is read from the text around it. */
export interface Occurrence {
  index: number
  whole: string
  quoted: Quoted
}

/** Both bounds accept an optional "about" or "roughly" between their words and the figure: "no more than about 10 times" is an upper bound. */
const LOWER_BOUND = /\b(?:more than|over|above|at least|upwards? of|in excess of|exceeding|greater than|beyond)\s+(?:about\s+|roughly\s+)?$/i
const UPPER_BOUND = /\b(?:less than|under|below|at most|fewer than|no more than)\s+(?:about\s+|roughly\s+)?$/i
/** One-sided approximations: the real value is a little under (nearly, almost, just under) or a little over (just over) the figure. */
const APPROX_BELOW = /\b(?:nearly|almost|just under|just below)\s+$/i
const APPROX_ABOVE = /\bjust over\s+$/i
/** "up to 50%" is a ceiling nobody states the value of; it is never matched. */
const VAGUE = /\bup to\s+$/i

/** How a figure's words limit it: a bound, a one-sided approximation, or vague. */
export function limitBefore(text: string, index: number): Pick<Quoted, 'bound' | 'approx' | 'vague'> {
  const before = clauseBefore(text, index).slice(-40)
  if (VAGUE.test(before)) return { vague: true }
  if (APPROX_BELOW.test(before)) return { approx: 'below' }
  if (APPROX_ABOVE.test(before)) return { approx: 'above' }
  // UPPER first: "no more than" contains "more than", which LOWER_BOUND also matches.
  return { bound: UPPER_BOUND.test(before) ? 'upper' : LOWER_BOUND.test(before) ? 'lower' : undefined }
}

/** Words that say a figure is approximate. */
const HEDGE = /(?:\b(?:about|roughly|around|approximately|approx\.?|nearly|almost|some|close to|just over|just under|circa)|~)\s*(?:\S+\s+){0,2}$/i

/** Whether an approximating word stands up to two words before the figure that starts at `index`, in the same sentence. */
export function isHedged(text: string, index: number): boolean {
  return HEDGE.test(clauseBefore(text, index).slice(-48))
}

const decimalsOf = (digits: string): number => digits.split('.')[1]?.length ?? 0
const num = (digits: string): number => Number(digits.replace(/,/g, ''))

/** Every percentage, count and multiple written in `text`, in order. A percentage range counts as one figure carrying its bounds. */
export function figureOccurrences(text: string): Occurrence[] {
  const found: Occurrence[] = [...text.matchAll(FIGURE)].map((match) => {
    const [whole, percent, scaled, word, grouped, multiple] = match
    const digits = (percent ?? scaled ?? grouped ?? multiple).replace(/,/g, '')
    const unit: Unit = percent !== undefined ? '%' : multiple !== undefined ? 'times' : 'count'
    return {
      index: match.index ?? 0,
      whole: whole.trim(),
      quoted: {
        unit,
        value: Number(digits),
        decimals: decimalsOf(digits),
        scale: word === undefined ? 1 : SCALES[word.toLowerCase()],
        sign: unit === '%' ? signOf(text, match.index ?? 0) : 0,
        hedged: isHedged(text, match.index ?? 0),
        ...limitBefore(text, match.index ?? 0),
      },
    }
  })
  // Ranges: "60 to 63%", "60-63%" (a bare number before the dash), "60% to 63%" and "between 60% and 63%".
  const merged: Occurrence[] = []
  for (const o of found) {
    if (o.quoted.unit !== '%') {
      merged.push(o)
      continue
    }
    const before = text.slice(0, o.index)
    const bare = /(\d[\d,]*(?:\.\d+)?)\s*(?:to|-|–|—)\s*$/.exec(before)
    const prev = merged[merged.length - 1]
    const gap = prev && prev.quoted.unit === '%' ? text.slice(prev.index + prev.whole.length, o.index) : null
    let start = -1
    let low = 0
    let lowDecimals = 0
    if (bare) {
      start = bare.index
      low = num(bare[1])
      lowDecimals = decimalsOf(bare[1].replace(/,/g, ''))
    } else if (prev && gap !== null && (/^\s*(?:to|-|–|—)\s*$/.test(gap) || (/^\s+and\s+$/i.test(gap) && /\bbetween\s+$/i.test(text.slice(0, prev.index))))) {
      start = prev.index
      low = prev.quoted.value
      lowDecimals = prev.quoted.decimals
      merged.pop()
    }
    if (start < 0) {
      merged.push(o)
      continue
    }
    const end = o.index + o.whole.length
    merged.push({
      index: start,
      whole: text.slice(start, end).trim(),
      quoted: { ...o.quoted, range: { low, high: o.quoted.value, decimals: Math.max(lowDecimals, o.quoted.decimals) }, hedged: isHedged(text, start), sign: signOf(text, start) },
    })
  }
  return merged
}

/** Significant figures of a count written in full: 99,000 has two, 120,000 has two, 100,000 has one. */
function significantFigures(value: number): number {
  return String(value).replace(/0+$/, '').length
}

/**
 * Whether `value`, divided by the figure's own scale and rounded to its own decimals, is what the figure says. A count
 * written out in full is exact, unless the text hedges it ("roughly 99,000") and it carries at least two significant
 * figures: then it may be the true value rounded to those. "Nearly" and "almost" keep that rounding, so "nearly 99,000" matches
 * 99,060; "just over" does not, since a value below the figure is not "just over" it. `allowHedge` is off where nothing says whose value it is.
 */
export function matchesQuoted(q: Quoted, value: number, allowHedge = true): boolean {
  if (q.vague) return false
  if (q.approx) {
    // A one-sided approximation is judged on its own side only: "nearly 30" is not 30.4, though 30.4 rounds to 30.
    const v = Math.abs(value) / q.scale
    const tolerance = Math.max(q.value * 0.05, 10 ** -q.decimals)
    if (q.approx === 'below' ? v <= q.value && v >= q.value - tolerance : v >= q.value && v <= q.value + tolerance) return true
  }
  if (q.bound) {
    const v = Math.abs(value) / q.scale
    if (q.bound === 'lower' ? v >= q.value : v <= q.value) return true
  }
  // Rounding to the written decimals. An approximation takes none of it, so "nearly 30" does not match 30.4. A whole count of two or
  // more significant figures keeps its hedge rounding under "nearly" or "almost" (so a value above the figure can match), but not
  // under "just over", which would accept a value below it.
  if (!q.approx && roundTo(Math.abs(value) / q.scale, q.decimals) === q.value) return true
  if (allowHedge && q.approx !== 'above' && q.hedged && q.unit === 'count' && q.scale === 1 && q.decimals === 0 && q.value > 0) {
    const sf = significantFigures(q.value)
    return sf >= 2 && Number(Math.abs(value).toPrecision(sf)) === q.value
  }
  return false
}

/** Whether the direction the text gives a trend figure agrees with the real value. A figure with no direction in the text passes. */
export function directionAgrees(q: Quoted, value: number): boolean {
  return q.sign === 0 || (q.sign < 0 ? value <= 0 : value >= 0)
}

/**
 * Whether a hedged count written with one significant figure ("nearly 100,000") is the true value rounded to that one
 * figure. Too coarse to count as a match, so a check leaves it unchecked rather than accepting or rejecting it.
 */
export function matchesCoarsely(q: Quoted, value: number): boolean {
  if (!(q.hedged && q.unit === 'count' && q.scale === 1 && q.decimals === 0 && q.value > 0)) return false
  return significantFigures(q.value) === 1 && Number(Math.abs(value).toPrecision(1)) === q.value
}

/** A multiple that compares something with its own past ("2 to 3 times faster than before"), not one package with another. */
export function comparesWithPast(text: string, end: number): boolean {
  return /^\s*(?:times\s+)?(?:(?:faster|slower|larger|bigger|smaller|more|less|quicker|higher|lower|as (?:fast|large|big|many|much))\s+)?(?:than|compared (?:to|with)|versus|vs\.?)\s+(?:before|last|previously|the previous|the prior|earlier|then|now|usual|normal|a year ago)\b/i.test(text.slice(end, end + 60))
}
