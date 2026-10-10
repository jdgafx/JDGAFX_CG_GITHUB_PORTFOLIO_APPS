import type { SortDir } from '../types'

/** The number words a question may use for a count of groups. */
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
export const NUMBER_WORD_LIST = Object.keys(NUMBER_WORDS).join('|')

/**
 * "top 3", "first five", "bottom 2", "last 4": an end of the ranking and how many groups to keep. A number that counts
 * a stretch of time ("the last 7 days", "first 12 months") is the window the rows cover, not a number of groups.
 */
export const RANKED_COUNT_SOURCE = `\\b(top|first|bottom|last)[\\s-]+(\\d+|${NUMBER_WORD_LIST})\\b(?!\\s*-?\\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\\b)`

/**
 * How many groups the question asks to keep and from which end: "top 3" and "first 3" keep the highest three, "bottom 3"
 * and "last 3" the lowest three. Null when it names no count, a count of time, or both ends at once.
 */
export function askedLimit(question: string): { count: number; dir: SortDir } | null {
  const found = [...question.matchAll(new RegExp(RANKED_COUNT_SOURCE, 'gi'))].map((match) => ({
    count: NUMBER_WORDS[(match[2] ?? '').toLowerCase()] ?? Number(match[2]),
    dir: /^(top|first)$/i.test(match[1] ?? '') ? ('desc' as const) : ('asc' as const),
  }))
  const first = found[0]
  return first && found.every((item) => item.dir === first.dir) ? first : null
}
