import type { Summary } from './contract'
import { contextOf } from './attribution'

/** Counts of unusual days written in an explanation ("3 unusual days", "twenty eight spikes"), and what the evidence says they should be. */

export interface Counted {
  value: number
  text: string
  index: number
}

const UNITS: Record<string, number> = Object.fromEntries(
  ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'].map((word, i) => [word, i]),
)
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50 }
const WORD_PATTERN = [...Object.keys(UNITS), ...Object.keys(TENS)].sort((a, b) => b.length - a.length).join('|')

/**
 * The small whole numbers written in `text`: digits that are not part of a longer run, a decimal, a date, a version or a
 * percentage, and number words ("eight", "twenty-five", "twenty eight").
 */
export function numberTokens(text: string): Counted[] {
  const found: Counted[] = []
  const pattern = new RegExp(`(?<![\\d.,/:-])(\\d{1,3})(?![\\d.,/:%-]\\d?)(?!\\s?%)|\\b(${WORD_PATTERN})(?:[-\\s]+(one|two|three|four|five|six|seven|eight|nine)\\b)?`, 'gi')
  for (const m of text.matchAll(pattern)) {
    if (m[1] !== undefined) found.push({ value: Number(m[1]), text: m[1], index: m.index ?? 0 })
    else {
      const base = m[2].toLowerCase()
      const value = (TENS[base] ?? UNITS[base]) + (m[3] && TENS[base] !== undefined ? UNITS[m[3].toLowerCase()] : 0)
      // "twenty one" is 21, but "one two" is not a number: a units word after a units word is a separate number.
      found.push({ value, text: TENS[base] !== undefined && m[3] ? m[0] : m[2], index: m.index ?? 0 })
    }
  }
  return found
}

/** The nouns a count of unusual days sits before. */
const ANCHOR = /\b(?:unusual(?:ly high)?|notable|outlier)\s+days?\b|\bspike\s+days?\b|\bspikes?\b|\bdays?\s+(?:stand|stood)s?\s+out\b/gi
const WITH_RELEASE = /\b(?:with|had|have|has)\s+(?:a |an |at least one )?(?:stable )?release|\bfollow(?:ed|s)?\s+(?:a |an |the )?(?:stable )?release/i
const NO_RELEASE = /\bno\s+(?:stable\s+)?release|\bwithout\s+(?:a |any )?(?:stable\s+)?release/i
/** A count of some of the unusual days only ("the other 10", "the remaining 8", "8 more") is not a count the evidence states. */
export const PARTIAL_COUNT = /\b(?:remaining|others?|rest|more|further|additional|else|besides|beyond)\b/i

export type Qualifier = 'with' | 'without' | null

const qualifierOf = (text: string): Qualifier => (NO_RELEASE.test(text) ? 'without' : WITH_RELEASE.test(text) ? 'with' : null)

/** The nearest number before `at` with at most three words and no other number between. */
function numberBefore(text: string, tokens: Counted[], at: number): Counted | null {
  const near = tokens.filter((t) => t.index + t.text.length <= at).pop()
  if (!near) return null
  const between = text.slice(near.index + near.text.length, at)
  return between.trim().split(/\s+/).filter((w) => w !== '').length <= 3 && !/[.;:!?\n]/.test(between) ? near : null
}

/**
 * The count a quote states and the release qualifier on it. A quote with two counts ("Of the 3 unusual days, 2 followed a
 * release") gives the one next to its qualifier, or the one next to "unusual days" when there is none; if that cannot be
 * told, it is ambiguous. Years, window lengths and dates are not counts of days that stand out.
 */
export function readSpikeCount(quote: string): { count: Counted; qualifier: Qualifier } | 'ambiguous' | null {
  const tokens = numberTokens(quote)
  if (tokens.length === 0) return null
  const qualifier = qualifierOf(quote)
  const qualified = qualifier === 'without' ? NO_RELEASE.exec(quote) : qualifier === 'with' ? WITH_RELEASE.exec(quote) : null
  if (qualified) {
    const near = numberBefore(quote, tokens, qualified.index)
    if (near) return { count: near, qualifier }
    return tokens.length === 1 ? { count: tokens[0], qualifier } : 'ambiguous'
  }
  for (const anchor of quote.matchAll(ANCHOR)) {
    const near = numberBefore(quote, tokens, anchor.index ?? 0)
    if (near) return { count: near, qualifier: null }
  }
  return tokens.length === 1 ? { count: tokens[0], qualifier: null } : 'ambiguous'
}

/**
 * The counts of unusual days the evidence allows for a package (or for all when `pkg` is null). The number found and the
 * number listed are both fair, because the list keeps each package's strongest few and an explanation may say either. A
 * count of only the days with or without a release can be told only from the list, so it is null when the list is capped.
 */
export function allowedCounts(s: Summary, pkg: string | null, qualifier: Qualifier): number[] | null {
  const listed = (s.spikes ?? []).filter((spike) => pkg === null || spike.name === pkg)
  const names = pkg === null ? s.packages.map((p) => p.name) : [pkg]
  const found = s.spikeCounts ? names.reduce((sum, name) => sum + (s.spikeCounts?.[name] ?? 0), 0) : null
  const capped = found !== null && found > listed.length
  if (qualifier === null) return found === null ? [listed.length] : [...new Set([listed.length, found])]
  if (capped) return null
  const subset = qualifier === 'with' ? listed.filter((spike) => spike.releases.length > 0) : listed.filter((spike) => spike.releasesKnown && spike.releases.length === 0)
  return [subset.length]
}

/** Whether the words say a count is of all the packages together. */
const TOTAL_WORDS = /\b(?:in total|in all|across|overall|combined|altogether|together|all (?:the |of the )?(?:packages|three|four|five|selected))\b/i

/**
 * Which package a count is about. The one the clause resolves to, unless the words say all together; with none named in
 * the clause or carried to it, the total. 'unresolved' when packages are named but none resolves to one.
 */
export function scopeOfCount(text: string, count: Counted, names: string[]): string | null | 'unresolved' {
  const ctx = contextOf(text, count.index, count.index + count.text.length, names)
  const clause = text.slice(Math.max(0, text.lastIndexOf('\n', count.index)), Math.min(text.length, count.index + 80))
  if (TOTAL_WORDS.test(clause)) return null
  if (ctx.owner) return ctx.owner
  return ctx.named.length === 0 && ctx.carried.length === 0 ? null : 'unresolved'
}

/** Every count of unusual days written in `text`, in order: the number before each "unusual days", "spikes" or "days stand out". */
export function writtenSpikeCounts(text: string): { count: Counted; clause: string }[] {
  const tokens = numberTokens(text)
  const found: { count: Counted; clause: string }[] = []
  const seen = new Set<number>()
  for (const anchor of text.matchAll(ANCHOR)) {
    const near = numberBefore(text, tokens, anchor.index ?? 0)
    if (!near || seen.has(near.index)) continue
    seen.add(near.index)
    // What belongs to this count: from the count to the next comma, full stop or break after its noun.
    const afterAnchor = (anchor.index ?? 0) + anchor[0].length
    const stop = text.slice(afterAnchor).search(/[,;:.!?\n]/)
    found.push({ count: near, clause: text.slice(near.index, stop < 0 ? text.length : afterAnchor + stop) })
  }
  return found
}

export { qualifierOf }
