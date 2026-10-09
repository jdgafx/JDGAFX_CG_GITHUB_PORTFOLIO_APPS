/** Reading the figures written in an explanation: percentages, counts, multiples, and how exactly each is written. */

export type Sign = 1 | -1 | 0

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
  const sentence = text.slice(0, start).split(/[;:!?\n]|\.(?=\s|$)/).pop() ?? ''
  const words = sentence.trim().split(/\s+/).slice(-DIRECTION_WORDS).reverse()
  for (const word of words) {
    const bare = word.toLowerCase().replace(/[^a-z]/g, '')
    if (RISE_WORDS.has(bare)) return 1
    if (FALL_WORDS.has(bare)) return -1
  }
  return 0
}

export type Unit = '%' | 'count' | 'times'

export interface Quoted {
  unit: Unit
  value: number
  decimals: number
  /** 1 for a figure written out in full, 1e6 for "million", and so on. */
  scale: number
  sign: Sign
  /** True when a hedge such as "about" or "roughly" stands a few words before the figure in its sentence. */
  hedged?: boolean
}

/** A checkable figure written in the text: where it starts, how it is written and what it says. Its sign is read from the text around it. */
export interface Occurrence {
  index: number
  whole: string
  quoted: Quoted
}

/** Words that say a figure is approximate. */
const HEDGE = /(?:\b(?:about|roughly|around|approximately|approx\.?|nearly|almost|some|close to|just over|just under|circa)|~)\s*(?:\S+\s+){0,2}$/i

/** Whether an approximating word stands up to two words before the figure that starts at `index`, in the same sentence. */
export function isHedged(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 48), index)
  const sentence = before.split(/[;:!?\n]|\.(?=\s|$)/).pop() ?? ''
  return HEDGE.test(sentence)
}

/** Every percentage, count and multiple written in `text`, in order. */
export function figureOccurrences(text: string): Occurrence[] {
  return [...text.matchAll(FIGURE)].map((match) => {
    const [whole, percent, scaled, word, grouped, multiple] = match
    const digits = (percent ?? scaled ?? grouped ?? multiple).replace(/,/g, '')
    const unit: Unit = percent !== undefined ? '%' : multiple !== undefined ? 'times' : 'count'
    return {
      index: match.index ?? 0,
      whole: whole.trim(),
      quoted: {
        unit,
        value: Number(digits),
        decimals: digits.split('.')[1]?.length ?? 0,
        scale: word === undefined ? 1 : SCALES[word.toLowerCase()],
        sign: unit === '%' ? signOf(text, match.index ?? 0) : 0,
        hedged: isHedged(text, match.index ?? 0),
      },
    }
  })
}

/** Significant figures of a count written in full: 99,000 has two, 120,000 has two, 100,000 has one. */
function significantFigures(value: number): number {
  return String(value).replace(/0+$/, '').length
}

/**
 * Whether `value`, divided by the figure's own scale and rounded to its own decimals, is what the figure says. A count
 * written out in full is exact, unless the text hedges it ("roughly 99,000") and it carries at least two significant
 * figures: then it may be the true value rounded to those. `allowHedge` is off where nothing says whose value it is.
 */
export function matchesQuoted(q: Quoted, value: number, allowHedge = true): boolean {
  if (roundTo(Math.abs(value) / q.scale, q.decimals) === q.value) return true
  if (allowHedge && q.hedged && q.unit === 'count' && q.scale === 1 && q.decimals === 0 && q.value > 0) {
    const sf = significantFigures(q.value)
    return sf >= 2 && Number(Math.abs(value).toPrecision(sf)) === q.value
  }
  return false
}

/** Whether the direction the text gives a trend figure agrees with the real value. A figure with no direction in the text passes. */
export function directionAgrees(q: Quoted, value: number): boolean {
  return q.sign === 0 || (q.sign < 0 ? value <= 0 : value >= 0)
}
